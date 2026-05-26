import { describe, it, expect, vi, beforeEach } from "vitest";
import { logLabelEvent, fetchAuditTrail } from "./audit-log.js";
import type { PairLabel } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLabel(overrides: Partial<PairLabel> = {}): PairLabel {
  return {
    label_id: "lbl-001",
    listing_id: "lst-001",
    photo_a_id: "ph-a",
    photo_b_id: "ph-b",
    scene_graph_version: "gemini-2.5-pro@2026-05-23",
    model_version_at_prediction: "picker-v1@2026-05-23",
    model_prediction_at_time: 0.8,
    operator_verdict: "good",
    transition_tag: "push_in",
    thumbnail_hash_a: "/photos/a.jpg",
    thumbnail_hash_b: "/photos/b.jpg",
    source_mode: "directors_cut",
    apprentice_predicted_verdict: null,
    apprentice_was_wrong: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSupabase(labelRow?: object, candidateRow?: object | null) {
  const upsertFn = vi.fn().mockResolvedValue({ error: null });

  const selectMock = vi.fn(() => ({
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: labelRow ?? null, error: labelRow ? null : { message: "not found" } }),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: candidateRow ?? null, error: null }),
  }));

  return {
    from: vi.fn((table: string) => {
      if (table === "gen2_pair_labels") {
        return {
          upsert: upsertFn,
          select: selectMock,
        };
      }
      // gen2_pair_candidates
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: candidateRow ?? null, error: null }),
        })),
      };
    }),
    _upsertFn: upsertFn,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("audit-log", () => {
  it("logLabelEvent: upserts all label fields including thumbnail hashes and model version", async () => {
    const label = makeLabel();
    const sb = makeSupabase();

    await logLabelEvent(sb, label);

    expect(sb._upsertFn).toHaveBeenCalledOnce();
    const [payload] = sb._upsertFn.mock.calls[0];
    expect(payload.label_id).toBe(label.label_id);
    expect(payload.thumbnail_hash_a).toBe(label.thumbnail_hash_a);
    expect(payload.thumbnail_hash_b).toBe(label.thumbnail_hash_b);
    expect(payload.model_version_at_prediction).toBe(label.model_version_at_prediction);
  });

  it("logLabelEvent: throws when supabase returns an error", async () => {
    const sb = {
      from: vi.fn(() => ({
        upsert: vi.fn().mockResolvedValue({ error: { message: "DB error" } }),
      })),
    } as any;

    await expect(logLabelEvent(sb, makeLabel())).rejects.toThrow("logLabelEvent failed");
  });

  it("fetchAuditTrail: returns hash_match_a=true when URL fingerprint matches stored hash", async () => {
    const label = makeLabel({
      thumbnail_hash_a: "/photos/a.jpg",
      thumbnail_hash_b: "/photos/b.jpg",
    });

    // Simulate DB returning the label, and candidate row with matching URLs
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "gen2_pair_labels") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: label, error: null }),
            })),
          };
        }
        // gen2_pair_candidates — return URLs that produce matching fingerprints
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                photo_a_url: "https://cdn.example.com/photos/a.jpg",
                photo_b_url: "https://cdn.example.com/photos/b.jpg",
              },
              error: null,
            }),
          })),
        };
      }),
    } as any;

    const trail = await fetchAuditTrail(sb, "lbl-001");

    // The fingerprint for "https://cdn.example.com/photos/a.jpg" is "/photos/a.jpg"
    // which matches thumbnail_hash_a = "/photos/a.jpg"
    expect(trail.hash_match_a).toBe(true);
    expect(trail.hash_match_b).toBe(true);
    expect(trail.label_id).toBe("lbl-001");
  });

  it("fetchAuditTrail: returns hash_match_a=false when URL fingerprint differs (photo swapped)", async () => {
    const label = makeLabel({
      thumbnail_hash_a: "/photos/original-a.jpg",
    });

    const sb = {
      from: vi.fn((table: string) => {
        if (table === "gen2_pair_labels") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: label, error: null }),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                photo_a_url: "https://cdn.example.com/photos/different-a.jpg",
                photo_b_url: null,
              },
              error: null,
            }),
          })),
        };
      }),
    } as any;

    const trail = await fetchAuditTrail(sb, "lbl-001");

    expect(trail.hash_match_a).toBe(false); // /photos/different-a.jpg ≠ /photos/original-a.jpg
    expect(trail.hash_match_b).toBe(false); // no URL → false
  });

  it("fetchAuditTrail: throws when label not found", async () => {
    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
        })),
      })),
    } as any;

    await expect(fetchAuditTrail(sb, "missing-id")).rejects.toThrow("not found");
  });
});
