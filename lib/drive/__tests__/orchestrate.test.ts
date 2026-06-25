/**
 * Tests for lib/drive/orchestrate.ts — approveIntake and regenerateIntake.
 *
 * All external collaborators are mocked:
 *   - intake-db: getIntake, setStatus, setPropertyId, appendFeedback
 *   - lib/db: createProperty, getSupabase, updatePropertyStatus
 *   - lib/mls/lookup: lookupMlsByAddress
 *   - lib/drive/client: listFinalImages, downloadFile
 *   - src/lib/photo-upload: uploadPhotosToStorage
 *   - lib/pipeline: runPipeline
 *
 * Covers:
 *   - Write-guard off → skipped + nothing created
 *   - Happy path → create + upload + trigger + generating
 *   - MLS enrichment throw → still creates with null fallbacks
 *   - Download/upload throw → status error
 *   - Wrong status → error (no creates)
 *   - regenerateIntake happy path
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks (hoisted) ────────────────────────────────────────────────────

vi.mock("../intake-db.js", () => ({
  getIntake: vi.fn(),
  setStatus: vi.fn().mockResolvedValue(undefined),
  setPropertyId: vi.fn().mockResolvedValue(undefined),
  appendFeedback: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../db.js", () => ({
  createProperty: vi.fn(),
  getSupabase: vi.fn(),
  updatePropertyStatus: vi.fn().mockResolvedValue(undefined),
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
}));

vi.mock("../../pipeline.js", () => ({
  runPipeline: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports (after vi.mock) ───────────────────────────────────────────────────

import { getIntake, setStatus, setPropertyId, appendFeedback } from "../intake-db.js";
import { createProperty, getSupabase, updatePropertyStatus } from "../../db.js";
import { lookupMlsByAddress } from "../../mls/lookup.js";
import { listFinalImages, downloadFile } from "../client.js";
import { uploadPhotosToStorage } from "../../../src/lib/photo-upload.js";
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

// Helper: build a minimal Supabase mock for regenerateIntake (reads + updates properties)
function makeRegenSupabase(existingCustomText: string | null = null) {
  const chain: Record<string, unknown> = {};
  const resolved = Promise.resolve({
    data: { custom_request_text: existingCustomText },
    error: null,
  });
  for (const m of ["select", "update", "eq", "neq", "order", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["maybeSingle"] = vi.fn().mockResolvedValue({
    data: { custom_request_text: existingCustomText },
    error: null,
  });
  chain["then"] = (resolve?: (v: unknown) => unknown) => resolved.then(resolve);
  chain["catch"] = (reject?: (e: unknown) => unknown) => resolved.catch(reject);
  return {
    from: vi.fn().mockReturnValue(chain),
  };
}

// ── approveIntake ─────────────────────────────────────────────────────────────

describe("approveIntake", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
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

    const result = await approveIntake("intake-1");
    expect(result.status).toBe("generating");
    expect(createProperty).toHaveBeenCalled();
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

  it("happy path: marks ingesting → creates property → uploads → fires pipeline → generating", async () => {
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

    const result = await approveIntake("intake-1");

    expect(result.status).toBe("generating");
    expect(result.propertyId).toBe("prop-new");

    // Status transitions
    const statusCalls = vi.mocked(setStatus).mock.calls;
    expect(statusCalls[0][1]).toBe("ingesting");
    expect(statusCalls[1][1]).toBe("generating");

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

    // Pipeline fired (fire-and-forget — just verify it was called)
    expect(runPipeline).toHaveBeenCalledWith("prop-new");

    // Property ID linked
    expect(setPropertyId).toHaveBeenCalledWith("intake-1", "prop-new");
  });

  it("happy path works for status=approved too", async () => {
    vi.mocked(getIntake).mockResolvedValue({ ...BASE_INTAKE, status: "approved" });
    vi.mocked(lookupMlsByAddress).mockResolvedValue(MLS_RESULT as never);
    vi.mocked(createProperty).mockResolvedValue(CREATED_PROPERTY as never);
    vi.mocked(listFinalImages).mockResolvedValue([]);

    const result = await approveIntake("intake-1");
    expect(result.status).toBe("generating");
  });

  // ── MLS enrichment failure ─────────────────────────────────────────────────

  it("creates property with null fallbacks when MLS lookup throws", async () => {
    vi.mocked(getIntake).mockResolvedValue(BASE_INTAKE);
    vi.mocked(lookupMlsByAddress).mockRejectedValue(new Error("APIFY not configured"));
    vi.mocked(createProperty).mockResolvedValue(CREATED_PROPERTY as never);
    vi.mocked(listFinalImages).mockResolvedValue([]);

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

  // ── Upload failure → status error ─────────────────────────────────────────

  it("sets status=error and returns error when upload throws", async () => {
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

    await approveIntake("intake-1");

    expect(createProperty).toHaveBeenCalledWith(
      expect.objectContaining({
        add_custom_request: true,
        custom_request_text: "Please focus on the kitchen",
      }),
    );
  });
});

// ── regenerateIntake ──────────────────────────────────────────────────────────

describe("regenerateIntake", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERCEL_ENV = "production";
    delete process.env.LE_ALLOW_NONPROD_WRITES;
  });

  afterEach(() => {
    process.env = { ...origEnv };
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

  it("happy path: appends notes + resets property to queued + fires pipeline", async () => {
    const intakeWithProp: DriveIntake = {
      ...BASE_INTAKE,
      status: "generating",
      property_id: "prop-existing",
    };
    vi.mocked(getIntake).mockResolvedValue(intakeWithProp);
    vi.mocked(getSupabase).mockReturnValue(
      makeRegenSupabase("original notes") as ReturnType<typeof getSupabase>,
    );

    const result = await regenerateIntake("intake-1", "new feedback");

    expect(result.status).toBe("generating");
    expect(result.propertyId).toBe("prop-existing");

    expect(appendFeedback).toHaveBeenCalledWith("intake-1", "new feedback");
    expect(updatePropertyStatus).toHaveBeenCalledWith("prop-existing", "queued");
    expect(runPipeline).toHaveBeenCalledWith("prop-existing");
  });

  it("returns error when property update throws", async () => {
    const intakeWithProp: DriveIntake = {
      ...BASE_INTAKE,
      status: "generating",
      property_id: "prop-existing",
    };
    vi.mocked(getIntake).mockResolvedValue(intakeWithProp);
    vi.mocked(appendFeedback).mockRejectedValue(new Error("DB write failed"));

    const result = await regenerateIntake("intake-1", "notes");

    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/DB write failed/);
    expect(runPipeline).not.toHaveBeenCalled();
  });
});
