import { describe, it, expect } from "vitest";
import {
  addItem,
  removeAt,
  duplicateAt,
  moveItem,
  type SequenceItem,
} from "../director-sequence";

// Helper: generate a simple monotonic key for tests
let _counter = 0;
function nextKey(): string {
  return `k${++_counter}`;
}

describe("addItem", () => {
  it("appends to empty sequence", () => {
    const seq = addItem([], "iter-A", nextKey());
    expect(seq).toHaveLength(1);
    expect(seq[0].iteration_id).toBe("iter-A");
  });

  it("appends to existing sequence", () => {
    let seq = addItem([], "iter-A", nextKey());
    seq = addItem(seq, "iter-B", nextKey());
    expect(seq).toHaveLength(2);
    expect(seq[1].iteration_id).toBe("iter-B");
  });

  it("does not mutate the original array", () => {
    const original: SequenceItem[] = [{ iteration_id: "iter-A", key: "orig-k1" }];
    const next = addItem(original, "iter-B", nextKey());
    expect(original).toHaveLength(1); // unchanged
    expect(next).toHaveLength(2);
  });
});

describe("key uniqueness — A/B collision scenario", () => {
  /**
   * Reproduces the original bug:
   * 1. Add clip A (key A-0)
   * 2. Add clip A again (key A-1)
   * 3. Remove the first A (index 0)
   * 4. Add clip A again
   * With the old code the new item would get key A-1 (prev.length === 1),
   * colliding with the surviving item. With the new counter approach, every
   * call to nextKey() yields a fresh value.
   */
  it("never produces duplicate keys under add/remove/add churn", () => {
    const kA1 = nextKey();
    const kA2 = nextKey();

    let seq = addItem([], "iter-A", kA1);
    seq = addItem(seq, "iter-A", kA2);
    // seq: [ {iter-A, kA1}, {iter-A, kA2} ]

    seq = removeAt(seq, 0);
    // seq: [ {iter-A, kA2} ]

    const kA3 = nextKey();
    seq = addItem(seq, "iter-A", kA3);
    // seq: [ {iter-A, kA2}, {iter-A, kA3} ]

    const keys = seq.map((item) => item.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length); // no duplicates
    expect(keys).not.toContain(kA1); // removed key not recycled
  });

  it("all keys across 20 random add/remove operations remain unique", () => {
    let seq: SequenceItem[] = [];
    const allKeys: string[] = [];

    for (let i = 0; i < 10; i++) {
      const k = nextKey();
      allKeys.push(k);
      seq = addItem(seq, `iter-${i % 3}`, k);
    }
    // Remove even indices
    for (let i = seq.length - 1; i >= 0; i -= 2) {
      seq = removeAt(seq, i);
    }
    // Add more
    for (let i = 0; i < 10; i++) {
      const k = nextKey();
      allKeys.push(k);
      seq = addItem(seq, `iter-${i % 3}`, k);
    }

    const liveKeys = seq.map((item) => item.key);
    const unique = new Set(liveKeys);
    expect(unique.size).toBe(liveKeys.length);
  });
});

describe("removeAt", () => {
  it("removes the item at the given index", () => {
    let seq = addItem([], "A", nextKey());
    seq = addItem(seq, "B", nextKey());
    seq = addItem(seq, "C", nextKey());

    const result = removeAt(seq, 1);
    expect(result).toHaveLength(2);
    expect(result[0].iteration_id).toBe("A");
    expect(result[1].iteration_id).toBe("C");
  });

  it("returns original sequence unchanged for out-of-bounds index", () => {
    let seq = addItem([], "A", nextKey());
    seq = addItem(seq, "B", nextKey());

    expect(removeAt(seq, -1)).toBe(seq); // same reference
    expect(removeAt(seq, 5)).toBe(seq);
  });

  it("removes from start", () => {
    let seq = addItem([], "A", nextKey());
    seq = addItem(seq, "B", nextKey());
    const result = removeAt(seq, 0);
    expect(result).toHaveLength(1);
    expect(result[0].iteration_id).toBe("B");
  });

  it("removes from end", () => {
    let seq = addItem([], "A", nextKey());
    seq = addItem(seq, "B", nextKey());
    const result = removeAt(seq, 1);
    expect(result).toHaveLength(1);
    expect(result[0].iteration_id).toBe("A");
  });
});

describe("duplicateAt", () => {
  it("inserts a copy immediately after the source index", () => {
    let seq = addItem([], "A", nextKey());
    seq = addItem(seq, "B", nextKey());
    seq = addItem(seq, "C", nextKey());

    const dupKey = nextKey();
    const result = duplicateAt(seq, 1, dupKey); // duplicate B
    expect(result).toHaveLength(4);
    expect(result[1].iteration_id).toBe("B"); // original still at 1
    expect(result[2].iteration_id).toBe("B"); // duplicate at 2
    expect(result[2].key).toBe(dupKey);        // uses provided key
    expect(result[3].iteration_id).toBe("C"); // C shifted to 3
  });

  it("duplicate gets a fresh key, not the original's key", () => {
    const origKey = nextKey();
    const seq = addItem([], "A", origKey);

    const dupKey = nextKey();
    const result = duplicateAt(seq, 0, dupKey);

    expect(result[0].key).toBe(origKey);
    expect(result[1].key).toBe(dupKey);
    expect(result[0].key).not.toBe(result[1].key);
  });

  it("returns original for out-of-bounds index", () => {
    const seq = addItem([], "A", nextKey());
    expect(duplicateAt(seq, 5, nextKey())).toEqual(seq);
  });

  it("can duplicate the last item (appended after it)", () => {
    let seq = addItem([], "A", nextKey());
    seq = addItem(seq, "B", nextKey());
    const result = duplicateAt(seq, 1, nextKey());
    expect(result).toHaveLength(3);
    expect(result[2].iteration_id).toBe("B");
  });
});

describe("moveItem", () => {
  it("moves an item forward", () => {
    let seq = addItem([], "A", nextKey());
    seq = addItem(seq, "B", nextKey());
    seq = addItem(seq, "C", nextKey());

    const result = moveItem(seq, 0, 2); // move A to end
    const ids = result.map((i) => i.iteration_id);
    expect(ids).toEqual(["B", "C", "A"]);
  });

  it("moves an item backward", () => {
    let seq = addItem([], "A", nextKey());
    seq = addItem(seq, "B", nextKey());
    seq = addItem(seq, "C", nextKey());

    const result = moveItem(seq, 2, 0); // move C to front
    const ids = result.map((i) => i.iteration_id);
    expect(ids).toEqual(["C", "A", "B"]);
  });

  it("is a no-op when from === to", () => {
    let seq = addItem([], "A", nextKey());
    seq = addItem(seq, "B", nextKey());
    const result = moveItem(seq, 1, 1);
    expect(result).toBe(seq); // same reference
  });

  it("clamps out-of-bounds `to` at end", () => {
    let seq = addItem([], "A", nextKey());
    seq = addItem(seq, "B", nextKey());
    seq = addItem(seq, "C", nextKey());

    const result = moveItem(seq, 0, 99); // clamps to 2
    const ids = result.map((i) => i.iteration_id);
    expect(ids).toEqual(["B", "C", "A"]);
  });

  it("clamps out-of-bounds `to` at start", () => {
    let seq = addItem([], "A", nextKey());
    seq = addItem(seq, "B", nextKey());
    seq = addItem(seq, "C", nextKey());

    const result = moveItem(seq, 2, -5); // clamps to 0
    const ids = result.map((i) => i.iteration_id);
    expect(ids).toEqual(["C", "A", "B"]);
  });

  it("clamps out-of-bounds `from` to valid position", () => {
    let seq = addItem([], "A", nextKey());
    seq = addItem(seq, "B", nextKey());
    // from=99 clamps to 1 (last), to=0 → move B to front
    const result = moveItem(seq, 99, 0);
    const ids = result.map((i) => i.iteration_id);
    expect(ids).toEqual(["B", "A"]);
  });

  it("returns unchanged sequence when length < 2", () => {
    const seq = addItem([], "A", nextKey());
    expect(moveItem(seq, 0, 0)).toBe(seq);
    expect(moveItem([], 0, 1)).toEqual([]);
  });
});
