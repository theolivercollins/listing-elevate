/**
 * Tests for the canonical order-status map and MoneyValue / StatusChip / EmptyState.
 * Written TDD — these tests were authored before the implementation.
 */

import { describe, it, expect } from "vitest";
import {
  ORDER_STATUS_MAP,
  orderStatusEntry,
  ALL_KNOWN_STATUSES,
} from "../order-status";

// ── 1. Exhaustive coverage ────────────────────────────────────────────────────

describe("ORDER_STATUS_MAP — exhaustive coverage", () => {
  it("covers every known PropertyStatus string", () => {
    const propertyStatuses: string[] = [
      "queued",
      "analyzing",
      "scripting",
      "generating",
      "qc",
      "assembling",
      "complete",
      "failed",
      "needs_review",
      "archived",
      "delivered",
      "ingesting",
    ];
    for (const s of propertyStatuses) {
      const entry = ORDER_STATUS_MAP[s];
      expect(entry, `Missing entry for PropertyStatus "${s}"`).toBeDefined();
      expect(entry?.label, `Empty label for "${s}"`).toBeTruthy();
      expect(entry?.color, `Empty color for "${s}"`).toBeTruthy();
    }
  });

  it("covers every known SceneStatus string", () => {
    const sceneStatuses: string[] = [
      "pending",
      "generating",
      "qc_pass",
      "qc_soft_reject",
      "qc_hard_reject",
      "retry_1",
      "retry_2",
      "failed",
      "needs_review",
    ];
    for (const s of sceneStatuses) {
      const entry = ORDER_STATUS_MAP[s];
      expect(entry, `Missing entry for SceneStatus "${s}"`).toBeDefined();
      expect(entry?.label).toBeTruthy();
      expect(entry?.color).toBeTruthy();
    }
  });

  it("maps user-facing labels per the spec", () => {
    // Operator labels (internal pipeline)
    expect(ORDER_STATUS_MAP["queued"]?.label).toBe("Received");
    expect(ORDER_STATUS_MAP["ingesting"]?.label).toBe("Crafting scenes");
    expect(ORDER_STATUS_MAP["analyzing"]?.label).toBe("Crafting scenes");
    expect(ORDER_STATUS_MAP["scripting"]?.label).toBe("Crafting scenes");
    expect(ORDER_STATUS_MAP["generating"]?.label).toBe("Rendering");
    expect(ORDER_STATUS_MAP["qc"]?.label).toBe("In review");
    expect(ORDER_STATUS_MAP["assembling"]?.label).toBe("In review");
    expect(ORDER_STATUS_MAP["complete"]?.label).toBe("Delivered");
    expect(ORDER_STATUS_MAP["delivered"]?.label).toBe("Delivered");
    expect(ORDER_STATUS_MAP["needs_review"]?.label).toBe("Needs attention");
    expect(ORDER_STATUS_MAP["failed"]?.label).toBe("Needs attention");
  });

  it("never falls through to undefined for any entry in ALL_KNOWN_STATUSES", () => {
    for (const s of ALL_KNOWN_STATUSES) {
      expect(ORDER_STATUS_MAP[s], `No entry for "${s}"`).toBeDefined();
    }
  });

  it("orderStatusEntry returns a fallback entry (never undefined) for unknown strings", () => {
    const fallback = orderStatusEntry("totally_unknown_status_xyz");
    expect(fallback).toBeDefined();
    expect(fallback.label).toBeTruthy();
    expect(fallback.color).toBeTruthy();
  });
});
