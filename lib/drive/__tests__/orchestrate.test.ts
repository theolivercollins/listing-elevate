/**
 * Tests for lib/drive/orchestrate.ts — approveIntake and regenerateIntake.
 *
 * All external collaborators are mocked:
 *   - intake-db: getIntake, setStatus, setPropertyId, appendFeedback,
 *                claimForApproval
 *   - lib/db: createProperty, getSupabase, updatePropertyStatus, insertPhotos
 *   - lib/mls/lookup: lookupMlsByAddress
 *   - lib/drive/client: listFinalImages, downloadFile
 *   - src/lib/photo-upload: uploadPhotosToStorage, getStoragePublicUrl
 *   - lib/pipeline: runPipeline
 *
 * Covers:
 *   - Write-guard off → skipped + nothing created
 *   - CAS claim false → skipped (already-processing)
 *   - Happy path → create + upload + insertPhotos + photo_count + trigger + generating
 *   - MLS enrichment throw → still creates with null fallbacks
 *   - Download/upload throw → status error
 *   - Wrong status → error (no creates)
 *   - Batch download: images capped at 80 with warn; batching works
 *   - regenerateIntake happy path + sets status 'generating'
 *   - regenerateIntake skips appendFeedback when notes is empty
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks (hoisted) ────────────────────────────────────────────────────

vi.mock("../intake-db.js", () => ({
  getIntake: vi.fn(),
  setStatus: vi.fn().mockResolvedValue(undefined),
  setPropertyId: vi.fn().mockResolvedValue(undefined),
  appendFeedback: vi.fn().mockResolvedValue(undefined),
  claimForApproval: vi.fn().mockResolvedValue(true),
  claimForRegenerate: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../db.js", () => ({
  createProperty: vi.fn(),
  getSupabase: vi.fn(),
  updatePropertyStatus: vi.fn().mockResolvedValue(undefined),
  insertPhotos: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../mls/lookup.js", () => ({
  lookupMlsByAddress: vi.fn(),
}));

vi.mock("../client.js", () => ({
  listFinalImages: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock("../../../src/lib/photo-upload.js", () => ({
  uploadPhotosToStorage: vi.fn().mockResolvedValue([]),
  getStoragePublicUrl: vi.fn().mockImplementation((p: string) => `https://cdn.example.com/${p}`),
}));

vi.mock("../../pipeline.js", () => ({
  runPipeline: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports (after vi.mock) ───────────────────────────────────────────────────

import { getIntake, setStatus, setPropertyId, appendFeedback, claimForApproval, claimForRegenerate } from "../intake-db.js";
import { createProperty, getSupabase, updatePropertyStatus, insertPhotos } from "../../db.js";
import { lookupMlsByAddress } from "../../mls/lookup.js";
import { listFinalImages, downloadFile } from "../client.js";
import { uploadPhotosToStorage, getStoragePublicUrl } from "../../../src/lib/photo-upload.js";
import { runPipeline } from "../../pipeline.js";
import { approveIntake, regenerateIntake } from "../orchestrate.js";
import type { DriveIntake } from "../intake-db.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_INTAKE: DriveIntake = {
  id: "intake-1",
  drive_folder_id: "folder-abc",
  address: "123 Main St, Austin, TX",
  final_folder_id: "final-xyz",
  photo_count: 10,
  last_count_change_at: "2026-01-01T00:00:00.000Z",
  status: "awaiting_approval",
  telegram_message_id: null,
  feedback_notes: null,
  property_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const MLS_RESULT = {
  source: "redfin",
  address: "123 Main St, Austin, TX",
  price: 550000,
  bedrooms: 4,
  bathrooms: 3,
  sqft: 2400,
  agent: "Jane Doe",
  description: "A lovely home",
  listingUrl: "https://redfin.com/home/123",
};

const CREATED_PROPERTY = {
  id: "prop-new",
  address: "123 Main St, Austin, TX",
  status: "queued",
  selected_package: "JUST_LISTED",
  selected_duration: 30,
  selected_orientation: "horizontal",
};

// Helper: build a chainable Supabase client mock.
// Handles any number of .from(...).update/select/eq/maybeSingle/... chains.
function makeSupabaseChain() {
  const chain: Record<string, unknown> = {};
  const resolved = Promise.resolve({ data: null, error: null });
  for (const m of [
    "select", "insert", "update", "upsert", "delete",
    "eq", "neq", "in", "order", "limit",
  ]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["maybeSingle"] = vi.fn().mockResolvedValue({ data: null, error: null });
  chain["single"] = vi.fn().mockResolvedValue({ data: null, error: null });
  chain["then"] = (resolve?: (v: unknown) => unknown) => resolved.then(resolve);
  chain["catch"] = (reject?: (e: unknown) => unknown) => resolved.catch(reject);
  return chain;
}

function makeSimpleSupabase() {
  const chain = makeSupabaseChain();
  return { from: vi.fn().mockReturnValue(chain) };
}

// Helper: build a Supabase mock for regenerateIntake (reads existing custom text)
function makeRegenSupabase(existingCustomText: string | null = null) {
  const chain = makeSupabaseChain();
  chain["maybeSingle"] = vi.fn().mockResolvedValue({
    data: { custom_request_text: existingCustomText },
    error: null,
  });
  return { from: vi.fn().mockReturnValue(chain) };
}

// ── approveIntake ─────────────────────────────────────────────────────────────

describe("approveIntake", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock behaviours that clearAllMocks wipes
    vi.mocked(setStatus).mockResolvedValue(undefined);
    vi.mocked(setPropertyId).mockResolvedValue(undefined);
    vi.mocked(appendFeedback).mockResolvedValue(undefined);
    vi.mocked(claimForApproval).mockResolvedValue(true);
    vi.mocked(insertPhotos).mockResolvedValue([]);
    vi.mocked(updatePropertyStatus).mockResolvedValue(undefined);
    vi.mocked(runPipeline).mockResolvedValue(undefined);
    vi.mocked(uploadPhotosToStorage).mockResolvedValue([]);
    vi.mocked(getStoragePublicUrl).mockImplementation((p: string) => `https://cdn.example.com/${p}`);
    // Default write-allowed env
    process.env.VERCEL_ENV = "production";
    delete process.env.LE_ALLOW_NONPROD_WRITES;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  // ── Write guard ────────────────────────────────────────────────────────────

  it("returns skipped when write guard is off — nothing is created", async () => {
    delete process.env.VERCEL_ENV;
    delete process.env.LE_ALLOW_NONPROD_WRITES;

    vi.mocked(getIntake).mockResolvedValue(BASE_INTAKE);

    const result = await approveIntake("intake-1");

    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/non-prod/);
    expect(createProperty).not.toHaveBeenCalled();
    expect(runPipeline).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
    expect(claimForApproval).not.toHaveBeenCalled();
  });

  it("returns skipped via LE_ALLOW_NONPROD_WRITES=false, VERCEL_ENV missing", async () => {
    delete process.env.VERCEL_ENV;
    process.env.LE_ALLOW_NONPROD_WRITES = "false";

    vi.mocked(getIntake).mockResolvedValue(BASE_INTAKE);

    const result = await approveIntake("intake-1");
    expect(result.status).toBe("skipped");
    expect(createProperty).not.toHaveBeenCalled();
  });

  it("allows writes when LE_ALLOW_NONPROD_WRITES=true", async () => {
    delete process.env.VERCEL_ENV;
    process.env.LE_ALLOW_NONPROD_WRITES = "true";

    vi.mocked(getIntake).mockResolvedValue(BASE_INTAKE);
    vi.mocked(lookupMlsByAddress).mockResolvedValue(MLS_RESULT as never);
    vi.mocked(createProperty).mockResolvedValue(CREATED_PROPERTY as never);
    vi.mocked(listFinalImages).mockResolvedValue([
      { id: "file-1", name: "img1.jpg", mimeType: "image/jpeg" },
    ]);
    vi.mocked(downloadFile).mockResolvedValue({
      bytes: new ArrayBuffer(8),
      name: "img1.jpg",
      mimeType: "image/jpeg",
    });
    // Fix 3 guard: upload must return at least one path or the result will be 'error'.
    vi.mocked(uploadPhotosToStorage).mockResolvedValue(["prop-new/raw/img1.jpg"]);
    vi.mocked(getSupabase).mockReturnValue(makeSimpleSupabase() as unknown as ReturnType<typeof getSupabase>);

    const result = await approveIntake("intake-1");
    expect(result.status).toBe("generating");
    expect(createProperty).toHaveBeenCalled();
  });

  // ── CAS claim guard ────────────────────────────────────────────────────────

  it("returns skipped (already-processing) when claimForApproval returns false", async () => {
    vi.mocked(getIntake).mockResolvedValue(BASE_INTAKE);
    vi.mocked(claimForApproval).mockResolvedValue(false);

    const result = await approveIntake("intake-1");

    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/already-processing/);
    expect(createProperty).not.toHaveBeenCalled();
    expect(runPipeline).not.toHaveBeenCalled();
    // setStatus is NOT called — claimForApproval owns the ingesting transition
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("calls claimForApproval with the intake id", async () => {
    vi.mocked(getIntake).mockResolvedValue(BASE_INTAKE);
    vi.mocked(lookupMlsByAddress).mockResolvedValue(MLS_RESULT as never);
    vi.mocked(createProperty).mockResolvedValue(CREATED_PROPERTY as never);
    vi.mocked(listFinalImages).mockResolvedValue([]);
    vi.mocked(getSupabase).mockReturnValue(makeSimpleSupabase() as unknown as ReturnType<typeof getSupabase>);

    await approveIntake("intake-1");

    expect(claimForApproval).toHaveBeenCalledWith("intake-1");
  });

  // ── Status guard ───────────────────────────────────────────────────────────

  it("returns error when intake status is not awaiting_approval/approved", async () => {
    vi.mocked(getIntake).mockResolvedValue({
      ...BASE_INTAKE,
      status: "generating",
    });

    const result = await approveIntake("intake-1");
    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/generating/);
    expect(createProperty).not.toHaveBeenCalled();
  });

  it("returns error when intake is not found", async () => {
    vi.mocked(getIntake).mockResolvedValue(null);

    const result = await approveIntake("intake-1");
    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/not found/);
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it("happy path: CAS claim → create property → upload → insertPhotos → photo_count → pipeline → generating", async () => {
    vi.mocked(getIntake).mockResolvedValue(BASE_INTAKE);
    vi.mocked(lookupMlsByAddress).mockResolvedValue(MLS_RESULT as never);
    vi.mocked(createProperty).mockResolvedValue(CREATED_PROPERTY as never);
    vi.mocked(listFinalImages).mockResolvedValue([
      { id: "file-1", name: "img1.jpg", mimeType: "image/jpeg" },
    ]);
    vi.mocked(downloadFile).mockResolvedValue({
      bytes: new ArrayBuffer(16),
      name: "img1.jpg",
      mimeType: "image/jpeg",
    });
    vi.mocked(uploadPhotosToStorage).mockResolvedValue(["prop-new/raw/img1.jpg"]);
    vi.mocked(getStoragePublicUrl).mockReturnValue("https://cdn.example.com/prop-new/raw/img1.jpg");
    vi.mocked(getSupabase).mockReturnValue(makeSimpleSupabase() as unknown as ReturnType<typeof getSupabase>);

    const result = await approveIntake("intake-1");

    expect(result.status).toBe("generating");
    expect(result.propertyId).toBe("prop-new");

    // CAS claim happened
    expect(claimForApproval).toHaveBeenCalledWith("intake-1");

    // Status: only 'generating' is set via setStatus (ingesting is done by claimForApproval internally)
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith("intake-1", "generating");

    // createProperty called with queued status and correct defaults
    expect(createProperty).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "123 Main St, Austin, TX",
        price: 550000,
        bedrooms: 4,
        bathrooms: 3,
        listing_agent: "Jane Doe",
        selected_package: "JUST_LISTED",
        selected_duration: 30,
        selected_orientation: "horizontal",
        submitted_by: "drive-intake",
        status: "queued",
      }),
    );

    // Photos uploaded
    expect(uploadPhotosToStorage).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(File)]),
      "prop-new/raw",
    );

    // insertPhotos called with correct record structure
    expect(insertPhotos).toHaveBeenCalledWith([
      {
        property_id: "prop-new",
        file_url: "https://cdn.example.com/prop-new/raw/img1.jpg",
        file_name: "img1.jpg",
      },
    ]);

    // Pipeline fired (fire-and-forget — just verify it was called)
    expect(runPipeline).toHaveBeenCalledWith("prop-new");

    // Property ID linked
    expect(setPropertyId).toHaveBeenCalledWith("intake-1", "prop-new");
  });

  it("returns error and does not fire pipeline when uploadPhotosToStorage returns empty paths (Fix 3 zero-photo guard)", async () => {
    vi.mocked(getIntake).mockResolvedValue(BASE_INTAKE);
    vi.mocked(lookupMlsByAddress).mockResolvedValue(MLS_RESULT as never);
    vi.mocked(createProperty).mockResolvedValue(CREATED_PROPERTY as never);
    vi.mocked(listFinalImages).mockResolvedValue([
      { id: "file-1", name: "img1.jpg", mimeType: "image/jpeg" },
    ]);
    vi.mocked(downloadFile).mockResolvedValue({
      bytes: new ArrayBuffer(8),
      name: "img1.jpg",
      mimeType: "image/jpeg",
    });
    // All uploads fail → empty paths; pipeline must NOT fire with zero photos
    vi.mocked(uploadPhotosToStorage).mockResolvedValue([]);
    vi.mocked(getSupabase).mockReturnValue(makeSimpleSupabase() as unknown as ReturnType<typeof getSupabase>);

    const result = await approveIntake("intake-1");

    // Fix 3: zero-photo ingest is an error, not a successful generating state
    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/0 photos/);

    // insertPhotos and runPipeline must not have been called
    expect(insertPhotos).not.toHaveBeenCalled();
    expect(runPipeline).not.toHaveBeenCalled();

    // Fix 2: property must be marked failed (propertyId was set before the throw)
    expect(updatePropertyStatus).toHaveBeenCalledWith("prop-new", "failed");

    // Intake must be set to error
    const statusCalls = vi.mocked(setStatus).mock.calls;
    expect(statusCalls[statusCalls.length - 1][1]).toBe("error");
  });

  it("happy path works for status=approved too", async () => {
    vi.mocked(getIntake).mockResolvedValue({ ...BASE_INTAKE, status: "approved" });
    vi.mocked(lookupMlsByAddress).mockResolvedValue(MLS_RESULT as never);
    vi.mocked(createProperty).mockResolvedValue(CREATED_PROPERTY as never);
    vi.mocked(listFinalImages).mockResolvedValue([]);
    // Fix 3 guard: ensure upload succeeds so the happy path reaches 'generating'.
    vi.mocked(uploadPhotosToStorage).mockResolvedValue(["prop-new/raw/img1.jpg"]);
    vi.mocked(getSupabase).mockReturnValue(makeSimpleSupabase() as unknown as ReturnType<typeof getSupabase>);

    const result = await approveIntake("intake-1");
    expect(result.status).toBe("generating");
  });

  // ── MLS enrichment failure ─────────────────────────────────────────────────

  it("creates property with null fallbacks when MLS lookup throws", async () => {
    vi.mocked(getIntake).mockResolvedValue(BASE_INTAKE);
    vi.mocked(lookupMlsByAddress).mockRejectedValue(new Error("APIFY not configured"));
    vi.mocked(createProperty).mockResolvedValue(CREATED_PROPERTY as never);
    vi.mocked(listFinalImages).mockResolvedValue([]);
    // Fix 3 guard: ensure upload succeeds so the test reaches 'generating'.
    vi.mocked(uploadPhotosToStorage).mockResolvedValue(["prop-new/raw/img1.jpg"]);
    vi.mocked(getSupabase).mockReturnValue(makeSimpleSupabase() as unknown as ReturnType<typeof getSupabase>);

    const result = await approveIntake("intake-1");

    expect(result.status).toBe("generating");
    expect(createProperty).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 0,
        bedrooms: 0,
        bathrooms: 0,
        listing_agent: "Unknown",
      }),
    );
  });

  // ── Upload / download failure → status error ──────────────────────────────

  it("sets status=error and returns error when download throws", async () => {
    vi.mocked(getIntake).mockResolvedValue(BASE_INTAKE);
    vi.mocked(lookupMlsByAddress).mockResolvedValue(MLS_RESULT as never);
    vi.mocked(createProperty).mockResolvedValue(CREATED_PROPERTY as never);
    vi.mocked(listFinalImages).mockResolvedValue([
      { id: "file-1", name: "img1.jpg", mimeType: "image/jpeg" },
    ]);
    vi.mocked(downloadFile).mockRejectedValue(new Error("Drive download failed"));

    const result = await approveIntake("intake-1");

    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/Drive download failed/);

    const statusCalls = vi.mocked(setStatus).mock.calls;
    expect(statusCalls[statusCalls.length - 1][1]).toBe("error");
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("sets status=error and returns error when createProperty throws", async () => {
    vi.mocked(getIntake).mockResolvedValue(BASE_INTAKE);
    vi.mocked(lookupMlsByAddress).mockResolvedValue(MLS_RESULT as never);
    vi.mocked(createProperty).mockRejectedValue(new Error("DB insert failed"));

    const result = await approveIntake("intake-1");

    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/DB insert failed/);

    const statusCalls = vi.mocked(setStatus).mock.calls;
    expect(statusCalls[statusCalls.length - 1][1]).toBe("error");
  });

  // ── Feedback notes propagation ────────────────────────────────────────────

  it("sets add_custom_request and custom_request_text when intake has feedback_notes", async () => {
    vi.mocked(getIntake).mockResolvedValue({
      ...BASE_INTAKE,
      feedback_notes: "Please focus on the kitchen",
    });
    vi.mocked(lookupMlsByAddress).mockResolvedValue(MLS_RESULT as never);
    vi.mocked(createProperty).mockResolvedValue(CREATED_PROPERTY as never);
    vi.mocked(listFinalImages).mockResolvedValue([]);
    vi.mocked(getSupabase).mockReturnValue(makeSimpleSupabase() as unknown as ReturnType<typeof getSupabase>);

    await approveIntake("intake-1");

    expect(createProperty).toHaveBeenCalledWith(
      expect.objectContaining({
        add_custom_request: true,
        custom_request_text: "Please focus on the kitchen",
      }),
    );
  });

  // ── Image cap / batch download ─────────────────────────────────────────────

  it("truncates images to 80 and console.warns when more than 80 are found", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Build 85 fake images
    const images = Array.from({ length: 85 }, (_, i) => ({
      id: `file-${i}`,
      name: `img${i}.jpg`,
      mimeType: "image/jpeg",
    }));
    vi.mocked(getIntake).mockResolvedValue(BASE_INTAKE);
    vi.mocked(lookupMlsByAddress).mockResolvedValue(MLS_RESULT as never);
    vi.mocked(createProperty).mockResolvedValue(CREATED_PROPERTY as never);
    vi.mocked(listFinalImages).mockResolvedValue(images);
    vi.mocked(downloadFile).mockResolvedValue({
      bytes: new ArrayBuffer(4),
      name: "x.jpg",
      mimeType: "image/jpeg",
    });
    // Return non-empty paths so the happy path (runPipeline + generating) is
    // exercised, not just the pre-upload truncation logic.
    vi.mocked(uploadPhotosToStorage).mockResolvedValue(["prop-new/raw/img0.jpg"]);
    vi.mocked(getSupabase).mockReturnValue(makeSimpleSupabase() as unknown as ReturnType<typeof getSupabase>);

    const result = await approveIntake("intake-1");

    // uploadPhotosToStorage receives exactly 80 File objects
    const uploadCall = vi.mocked(uploadPhotosToStorage).mock.calls[0];
    expect(uploadCall[0]).toHaveLength(80);

    // downloadFile called exactly 80 times (not 85)
    expect(vi.mocked(downloadFile)).toHaveBeenCalledTimes(80);

    // warn fired about truncation
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("85"),
    );

    // Full happy path exercised — pipeline fired and status reached 'generating'
    expect(result.status).toBe("generating");
    expect(runPipeline).toHaveBeenCalledWith("prop-new");

    warnSpy.mockRestore();
  });

  it("downloads all images in batches without missing any (≤80)", async () => {
    const images = Array.from({ length: 12 }, (_, i) => ({
      id: `file-${i}`,
      name: `img${i}.jpg`,
      mimeType: "image/jpeg",
    }));
    vi.mocked(getIntake).mockResolvedValue(BASE_INTAKE);
    vi.mocked(lookupMlsByAddress).mockResolvedValue(MLS_RESULT as never);
    vi.mocked(createProperty).mockResolvedValue(CREATED_PROPERTY as never);
    vi.mocked(listFinalImages).mockResolvedValue(images);
    vi.mocked(downloadFile).mockResolvedValue({
      bytes: new ArrayBuffer(4),
      name: "x.jpg",
      mimeType: "image/jpeg",
    });
    // Return non-empty paths so the happy path (runPipeline + generating) is
    // exercised, not just the pre-upload batching logic.
    vi.mocked(uploadPhotosToStorage).mockResolvedValue(["prop-new/raw/img0.jpg"]);
    vi.mocked(getSupabase).mockReturnValue(makeSimpleSupabase() as unknown as ReturnType<typeof getSupabase>);

    const result = await approveIntake("intake-1");

    // All 12 images downloaded and uploaded
    expect(vi.mocked(downloadFile)).toHaveBeenCalledTimes(12);
    const uploadCall = vi.mocked(uploadPhotosToStorage).mock.calls[0];
    expect(uploadCall[0]).toHaveLength(12);

    // Full happy path exercised — pipeline fired and status reached 'generating'
    expect(result.status).toBe("generating");
    expect(runPipeline).toHaveBeenCalledWith("prop-new");
  });
});

// ── regenerateIntake ──────────────────────────────────────────────────────────

describe("regenerateIntake", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setStatus).mockResolvedValue(undefined);
    vi.mocked(appendFeedback).mockResolvedValue(undefined);
    vi.mocked(updatePropertyStatus).mockResolvedValue(undefined);
    vi.mocked(runPipeline).mockResolvedValue(undefined);
    // Fix 4: claimForRegenerate must succeed by default for happy-path tests.
    vi.mocked(claimForRegenerate).mockResolvedValue(true);
    process.env.VERCEL_ENV = "production";
    delete process.env.LE_ALLOW_NONPROD_WRITES;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  // ── CAS guard (Fix 4) ──────────────────────────────────────────────────────

  it("returns skipped (already-processing) when claimForRegenerate returns false", async () => {
    vi.mocked(getIntake).mockResolvedValue({
      ...BASE_INTAKE,
      status: "rendered",
      property_id: "prop-existing",
    });
    vi.mocked(claimForRegenerate).mockResolvedValue(false);

    const result = await regenerateIntake("intake-1", "new notes");

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("already-processing");
    // Nothing mutating should have been called
    expect(appendFeedback).not.toHaveBeenCalled();
    expect(runPipeline).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("calls claimForRegenerate with the intake id", async () => {
    const intakeWithProp: DriveIntake = {
      ...BASE_INTAKE,
      status: "rendered",
      property_id: "prop-existing",
    };
    vi.mocked(getIntake).mockResolvedValue(intakeWithProp);
    vi.mocked(getSupabase).mockReturnValue(
      makeRegenSupabase(null) as unknown as ReturnType<typeof getSupabase>,
    );

    await regenerateIntake("intake-1", "");

    expect(claimForRegenerate).toHaveBeenCalledWith("intake-1");
  });

  it("returns skipped when write guard is off", async () => {
    delete process.env.VERCEL_ENV;
    delete process.env.LE_ALLOW_NONPROD_WRITES;

    const result = await regenerateIntake("intake-1", "new notes");

    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/non-prod/);
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("returns error when intake is not found", async () => {
    vi.mocked(getIntake).mockResolvedValue(null);

    const result = await regenerateIntake("intake-1", "notes");
    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/not found/);
  });

  it("returns error when intake has no property_id", async () => {
    vi.mocked(getIntake).mockResolvedValue({
      ...BASE_INTAKE,
      property_id: null,
    });

    const result = await regenerateIntake("intake-1", "notes");
    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/approveIntake first/);
  });

  it("happy path: appends notes + resets property to queued + fires pipeline + sets status generating", async () => {
    const intakeWithProp: DriveIntake = {
      ...BASE_INTAKE,
      status: "rendered",
      property_id: "prop-existing",
    };
    vi.mocked(getIntake).mockResolvedValue(intakeWithProp);
    vi.mocked(getSupabase).mockReturnValue(
      makeRegenSupabase("original notes") as unknown as ReturnType<typeof getSupabase>,
    );

    const result = await regenerateIntake("intake-1", "new feedback");

    expect(result.status).toBe("generating");
    expect(result.propertyId).toBe("prop-existing");

    expect(appendFeedback).toHaveBeenCalledWith("intake-1", "new feedback");
    expect(updatePropertyStatus).toHaveBeenCalledWith("prop-existing", "queued");
    expect(runPipeline).toHaveBeenCalledWith("prop-existing");

    // Re-arms pollResults by setting status back to 'generating'
    expect(setStatus).toHaveBeenCalledWith("intake-1", "generating");
  });

  it("skips appendFeedback and notes merge when notes is empty string", async () => {
    const intakeWithProp: DriveIntake = {
      ...BASE_INTAKE,
      status: "rendered",
      property_id: "prop-existing",
    };
    vi.mocked(getIntake).mockResolvedValue(intakeWithProp);
    vi.mocked(getSupabase).mockReturnValue(
      makeRegenSupabase(null) as unknown as ReturnType<typeof getSupabase>,
    );

    const result = await regenerateIntake("intake-1", "");

    expect(result.status).toBe("generating");
    // No appendFeedback call for empty notes
    expect(appendFeedback).not.toHaveBeenCalled();
    // Pipeline and status still fire
    expect(runPipeline).toHaveBeenCalledWith("prop-existing");
    expect(setStatus).toHaveBeenCalledWith("intake-1", "generating");
  });

  it("skips appendFeedback when notes is whitespace-only", async () => {
    const intakeWithProp: DriveIntake = {
      ...BASE_INTAKE,
      status: "rendered",
      property_id: "prop-existing",
    };
    vi.mocked(getIntake).mockResolvedValue(intakeWithProp);
    vi.mocked(getSupabase).mockReturnValue(
      makeRegenSupabase(null) as unknown as ReturnType<typeof getSupabase>,
    );

    const result = await regenerateIntake("intake-1", "   ");

    expect(result.status).toBe("generating");
    expect(appendFeedback).not.toHaveBeenCalled();
  });

  it("returns error when property update throws", async () => {
    const intakeWithProp: DriveIntake = {
      ...BASE_INTAKE,
      status: "rendered",
      property_id: "prop-existing",
    };
    vi.mocked(getIntake).mockResolvedValue(intakeWithProp);
    vi.mocked(appendFeedback).mockRejectedValue(new Error("DB write failed"));

    const result = await regenerateIntake("intake-1", "notes");

    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/DB write failed/);
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("resets intake to status=error (not pinned at ingesting) when a step throws after the CAS claim", async () => {
    // Simulate a transient failure that occurs AFTER claimForRegenerate succeeds.
    // Without the fix, the intake row is left pinned at 'ingesting': the poll
    // reaper skips it (property_id IS NOT NULL) and claimForRegenerate won't
    // accept it (only rendered/generating/error states), so recovery needs a
    // manual DB edit.
    const intakeWithProp: DriveIntake = {
      ...BASE_INTAKE,
      status: "rendered",
      property_id: "prop-existing",
    };
    vi.mocked(getIntake).mockResolvedValue(intakeWithProp);
    // updatePropertyStatus is called unconditionally inside the try block —
    // make it throw to simulate a transient DB error mid-regen.
    vi.mocked(updatePropertyStatus).mockRejectedValue(new Error("transient DB error"));

    const result = await regenerateIntake("intake-1", "");

    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/transient DB error/);

    // Critical: catch block must reset the intake row so the operator can re-tap.
    expect(setStatus).toHaveBeenCalledWith("intake-1", "error", {
      feedback_notes: expect.stringContaining("transient DB error"),
    });

    // Pipeline must NOT have fired.
    expect(runPipeline).not.toHaveBeenCalled();
  });
});
