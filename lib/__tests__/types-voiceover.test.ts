// Type smoke tests for the ElevenLabs voiceover additions (migration 056).
// No real DB calls — these only confirm the TypeScript shapes compile correctly.
import { describe, expectTypeOf, it } from "vitest";
import type { Property, UserProfile } from "../types.js";

describe("Property — voiceover columns", () => {
  it("has nullable voiceover_script", () => {
    expectTypeOf<Property["voiceover_script"]>().toEqualTypeOf<string | null>();
  });

  it("has nullable voiceover_audio_url", () => {
    expectTypeOf<Property["voiceover_audio_url"]>().toEqualTypeOf<string | null>();
  });

  it("has nullable voiceover_voice_id_used", () => {
    expectTypeOf<Property["voiceover_voice_id_used"]>().toEqualTypeOf<string | null>();
  });

  it("has nullable voiceover_chars as number", () => {
    expectTypeOf<Property["voiceover_chars"]>().toEqualTypeOf<number | null>();
  });

  it("has nullable voiceover_duration_seconds as number", () => {
    expectTypeOf<Property["voiceover_duration_seconds"]>().toEqualTypeOf<number | null>();
  });
});

describe("UserProfile — voice-clone columns", () => {
  it("has nullable elevenlabs_voice_id", () => {
    expectTypeOf<UserProfile["elevenlabs_voice_id"]>().toEqualTypeOf<string | null>();
  });

  it("voice_clone_status is the four-value union", () => {
    expectTypeOf<UserProfile["voice_clone_status"]>().toEqualTypeOf<
      "none" | "enrolling" | "ready" | "failed"
    >();
  });

  it("has nullable voice_clone_created_at", () => {
    expectTypeOf<UserProfile["voice_clone_created_at"]>().toEqualTypeOf<string | null>();
  });

  it("has nullable voice_clone_paid_cents as number", () => {
    expectTypeOf<UserProfile["voice_clone_paid_cents"]>().toEqualTypeOf<number | null>();
  });

  it("has nullable voice_clone_paid_at", () => {
    expectTypeOf<UserProfile["voice_clone_paid_at"]>().toEqualTypeOf<string | null>();
  });

  it("has nullable voice_clone_sample_url", () => {
    expectTypeOf<UserProfile["voice_clone_sample_url"]>().toEqualTypeOf<string | null>();
  });

  it("full object shape is assignable", () => {
    const profile: UserProfile = {
      id: "abc",
      user_id: "u1",
      role: "user",
      first_name: null,
      last_name: null,
      phone: null,
      email: null,
      brokerage: null,
      logo_url: null,
      colors: null,
      presets: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      elevenlabs_voice_id: null,
      voice_clone_status: "none",
      voice_clone_created_at: null,
      voice_clone_paid_cents: null,
      voice_clone_paid_at: null,
      voice_clone_sample_url: null,
    };
    expectTypeOf(profile).toMatchTypeOf<UserProfile>();
  });
});
