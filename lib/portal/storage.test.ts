import { describe, it, expect } from "vitest";
import { objectPathFor, splitExtension } from "./storage.js";

describe("objectPathFor", () => {
  it("composes owner/order/deliverable/v<n>.<ext>", () => {
    expect(objectPathFor({
      ownerId: "a1",
      orderId: "b2",
      deliverableId: "c3",
      version: 2,
      fileName: "Walkthrough.MOV",
    })).toBe("a1/b2/c3/v2.mov");
  });

  it("lowercases extension", () => {
    expect(objectPathFor({
      ownerId: "a1", orderId: "b2", deliverableId: "c3", version: 1, fileName: "clip.MP4",
    })).toBe("a1/b2/c3/v1.mp4");
  });

  it("throws on unknown extension", () => {
    expect(() => objectPathFor({
      ownerId: "a1", orderId: "b2", deliverableId: "c3", version: 1, fileName: "x.avi",
    })).toThrow(/extension/i);
  });
});

describe("splitExtension", () => {
  it("returns lowercase extension without dot", () => {
    expect(splitExtension("foo.MP4")).toBe("mp4");
  });
  it("returns null when no extension", () => {
    expect(splitExtension("foo")).toBeNull();
  });
});
