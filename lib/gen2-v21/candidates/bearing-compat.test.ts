import { describe, it, expect } from "vitest";
import { bearingCompatible } from "./bearing-compat.js";

describe("bearingCompatible", () => {
  it("looking_into_room + looking_into_room = 0.9 (good — different entry angles)", () => {
    expect(bearingCompatible("looking_into_room", "looking_into_room")).toBe(0.9);
  });

  it("looking_into_room + looking_out_of_room = 0.2 (bad — opposing)", () => {
    expect(bearingCompatible("looking_into_room", "looking_out_of_room")).toBe(0.2);
  });

  it("looking_out_of_room + looking_into_room = 0.2 (symmetric)", () => {
    expect(bearingCompatible("looking_out_of_room", "looking_into_room")).toBe(0.2);
  });

  it("parallel_to_wall_N + parallel_to_wall_S = 0.1 (180-degree opposing walls)", () => {
    expect(bearingCompatible("parallel_to_wall_N", "parallel_to_wall_S")).toBe(0.1);
  });

  it("parallel_to_wall_E + parallel_to_wall_W = 0.1 (180-degree opposing walls)", () => {
    expect(bearingCompatible("parallel_to_wall_E", "parallel_to_wall_W")).toBe(0.1);
  });

  it("parallel_to_wall_N + parallel_to_wall_E = 0.6 (perpendicular walls — good)", () => {
    expect(bearingCompatible("parallel_to_wall_N", "parallel_to_wall_E")).toBe(0.6);
  });

  it("unknown + unknown = 0.5", () => {
    expect(bearingCompatible("unknown", "unknown")).toBe(0.5);
  });

  it("unknown + looking_into_room = 0.5", () => {
    expect(bearingCompatible("unknown", "looking_into_room")).toBe(0.5);
  });

  it("is symmetric: N+W === W+N", () => {
    expect(bearingCompatible("parallel_to_wall_N", "parallel_to_wall_W")).toBe(
      bearingCompatible("parallel_to_wall_W", "parallel_to_wall_N"),
    );
  });
});
