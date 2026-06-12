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
import { ALL_PROPERTY_STATUSES, ALL_SCENE_STATUSES } from "../types";

// ── 1. Exhaustive coverage ────────────────────────────────────────────────────

describe("ORDER_STATUS_MAP — exhaustive coverage", () => {
  it("covers every PropertyStatus from the union", () => {
    for (const status of ALL_PROPERTY_STATUSES) {
      const entry = ORDER_STATUS_MAP[status];
      expect(entry, `Missing entry for PropertyStatus "${status}"`).toBeDefined();
      expect(entry?.label, `Empty label for "${status}"`).toBeTruthy();
      expect(entry?.color, `Empty color for "${status}"`).toBeTruthy();
      expect(entry?.bg, `Empty bg for "${status}"`).toBeTruthy();
    }
  });

  it("covers every SceneStatus from the union", () => {
    for (const status of ALL_SCENE_STATUSES) {
      const entry = ORDER_STATUS_MAP[status];
      expect(entry, `Missing entry for SceneStatus "${status}"`).toBeDefined();
      expect(entry?.label, `Empty label for "${status}"`).toBeTruthy();
      expect(entry?.color, `Empty color for "${status}"`).toBeTruthy();
      expect(entry?.bg, `Empty bg for "${status}"`).toBeTruthy();
    }
  });

  it("FAILS if a PropertyStatus is added to the union without an ORDER_STATUS_MAP entry", () => {
    // This test verifies the CI gate: if you add a new status to the PropertyStatus union
    // without also adding it to ORDER_STATUS_MAP, this test will fail at build time.
    // To pass this test, ensure ALL_PROPERTY_STATUSES matches the union and every entry
    // has a mapping in ORDER_STATUS_MAP.
    for (const status of ALL_PROPERTY_STATUSES) {
      expect(ORDER_STATUS_MAP).toHaveProperty(status);
    }
  });

  it("FAILS if a SceneStatus is added to the union without an ORDER_STATUS_MAP entry", () => {
    // Same CI gate for SceneStatus.
    for (const status of ALL_SCENE_STATUSES) {
      expect(ORDER_STATUS_MAP).toHaveProperty(status);
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
