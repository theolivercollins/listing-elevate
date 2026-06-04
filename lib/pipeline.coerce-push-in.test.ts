import { describe, it, expect } from "vitest";
import { coerceToPushInForV11 } from "./pipeline.js";

describe("coerceToPushInForV11", () => {
  it("v1.1: coerces non-paired scenes to push_in", () => {
    const scenes = [
      { camera_movement: "drone_push_in", end_photo_id: null },
      { camera_movement: "top_down", end_photo_id: undefined },
    ];
    const result = coerceToPushInForV11(scenes, "v1.1");
    expect(result[0].camera_movement).toBe("push_in");
    expect(result[1].camera_movement).toBe("push_in");
  });

  it("v1.1: paired scene (end_photo_id set) keeps its camera_movement", () => {
    const scenes = [
      { camera_movement: "orbit", end_photo_id: "photo-abc-123" },
    ];
    const result = coerceToPushInForV11(scenes, "v1.1");
    expect(result[0].camera_movement).toBe("orbit");
  });

  it("v1: all movements unchanged", () => {
    const scenes = [
      { camera_movement: "drone_push_in", end_photo_id: null },
      { camera_movement: "orbit", end_photo_id: "some-id" },
      { camera_movement: "parallax", end_photo_id: undefined },
    ];
    const result = coerceToPushInForV11(scenes, "v1");
    expect(result[0].camera_movement).toBe("drone_push_in");
    expect(result[1].camera_movement).toBe("orbit");
    expect(result[2].camera_movement).toBe("parallax");
  });

  it("does not mutate input objects", () => {
    const scene = { camera_movement: "drone_push_in", end_photo_id: null };
    const scenes = [scene];
    coerceToPushInForV11(scenes, "v1.1");
    expect(scene.camera_movement).toBe("drone_push_in");
  });

  it("v1.1: mixed paired and non-paired — coerces only non-paired", () => {
    const scenes = [
      { camera_movement: "reveal", end_photo_id: null },
      { camera_movement: "orbit", end_photo_id: "photo-xyz" },
      { camera_movement: "low_angle_glide", end_photo_id: undefined },
    ];
    const result = coerceToPushInForV11(scenes, "v1.1");
    expect(result[0].camera_movement).toBe("push_in");
    expect(result[1].camera_movement).toBe("orbit");
    expect(result[2].camera_movement).toBe("push_in");
  });
});
