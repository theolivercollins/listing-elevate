import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockRequireAdmin = vi.fn();
const mockGetRun = vi.fn();
const mockGetVariantsForRun = vi.fn();
const mockGetEventsForRun = vi.fn();
const mockGetPairedSceneIds = vi.fn();
const mockAdvanceRun = vi.fn();
const mockClearRunError = vi.fn();
const mockSetRunError = vi.fn();
const mockUpdateRun = vi.fn();
const mockRecordMlEvent = vi.fn();
const mockSetListingDetails = vi.fn();
const mockValidateListingDetails = vi.fn();
const mockRegenerateVariant = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbFrom = vi.fn();
const mockGenerateDeliveryScript = vi.fn();
const mockDbSelect = vi.fn();
const mockGenerateVoiceoverAudio = vi.fn();
const mockComposeMusic = vi.fn();
const mockDbInsert = vi.fn();
const mockDbStorage = vi.fn();
const mockRunAssembleStage = vi.fn();

vi.mock('../../../../../lib/auth', () => ({ requireAdmin: (...a: unknown[]) => mockRequireAdmin(...a) }));
vi.mock('../../../../../lib/delivery/runs', () => ({
  getRun: (...a: unknown[]) => mockGetRun(...a),
  getVariantsForRun: (...a: unknown[]) => mockGetVariantsForRun(...a),
  getEventsForRun: (...a: unknown[]) => mockGetEventsForRun(...a),
  getPairedSceneIds: (...a: unknown[]) => mockGetPairedSceneIds(...a),
  advanceRun: (...a: unknown[]) => mockAdvanceRun(...a),
  clearRunError: (...a: unknown[]) => mockClearRunError(...a),
  setRunError: (...a: unknown[]) => mockSetRunError(...a),
  updateRun: (...a: unknown[]) => mockUpdateRun(...a),
  recordMlEvent: (...a: unknown[]) => mockRecordMlEvent(...a),
  setListingDetails: (...a: unknown[]) => mockSetListingDetails(...a),
}));
vi.mock('../../../../../lib/delivery/details', () => ({
  validateListingDetails: (...a: unknown[]) => mockValidateListingDetails(...a),
}));
vi.mock('../../../../../lib/delivery/variants', () => ({
  regenerateVariant: (...a: unknown[]) => mockRegenerateVariant(...a),
}));
const mockShortenDeliveryScript = vi.fn();
vi.mock('../../../../../lib/delivery/voiceover-script', () => ({
  generateDeliveryScript: (...a: unknown[]) => mockGenerateDeliveryScript(...a),
  shortenDeliveryScript: (...a: unknown[]) => mockShortenDeliveryScript(...a),
}));
vi.mock('../../../../../lib/voiceover/generate-script', () => ({
  countWords: (t: string) => t.trim().split(/\s+/).filter(Boolean).length,
}));
vi.mock('../../../../../lib/voiceover/audio-tags', () => ({
  stripAudioTags: (t: string) => t,
}));
vi.mock('../../../../../lib/voiceover/generate-audio', () => ({
  generateVoiceoverAudio: (...a: unknown[]) => mockGenerateVoiceoverAudio(...a),
}));
vi.mock('../../../../../lib/providers/elevenlabs-music', () => ({
  composeMusic: (...a: unknown[]) => mockComposeMusic(...a),
  MOOD_PROMPTS: { upbeat: 'upbeat prompt', warm: 'warm prompt', celebratory: 'celebratory prompt', cinematic: 'cinematic prompt', neutral: 'neutral prompt' },
}));
vi.mock('../../../../../lib/delivery/assemble', () => ({
  runAssembleStage: (...a: unknown[]) => mockRunAssembleStage(...a),
}));

const mockParseFeedbackComment = vi.fn();
vi.mock('../../../../../lib/delivery/parse-feedback', () => ({
  parseFeedbackComment: (...a: unknown[]) => mockParseFeedbackComment(...a),
}));
vi.mock('../../../../../lib/client', () => ({
  getSupabase: () => ({
    from: (...a: unknown[]) => mockDbFrom(...a),
    storage: {
      from: (...a: unknown[]) => mockDbStorage(...a),
    },
  }),
}));

import handler from '../[runId]';

function makeRes() {
  return {
    _status: 0, _body: {} as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
  };
}
const adminUser = { user: { id: 'u1', email: 'a@t.com' }, profile: { role: 'admin' } };
const run = { id: 'r1', property_id: 'p1', stage: 'checkpoint_a' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminUser);
  mockGetRun.mockResolvedValue(run);
  mockGetVariantsForRun.mockResolvedValue([]);
  mockGetEventsForRun.mockResolvedValue([]);
  mockGetPairedSceneIds.mockResolvedValue([]);
  mockSetListingDetails.mockResolvedValue({ ...run, listing_details: { price: 899000, source: 'manual' } });
  mockRecordMlEvent.mockResolvedValue(undefined);
  mockValidateListingDetails.mockReturnValue({ ok: true, details: { price: 899000, source: 'manual' } });
  mockRegenerateVariant.mockResolvedValue(undefined);
  mockUpdateRun.mockResolvedValue({ ...run, voiceover_script: 'Welcome to X St.' });
  mockGenerateDeliveryScript.mockResolvedValue({ script: 'Welcome to X St.', wordCount: 4 });
  mockGenerateVoiceoverAudio.mockResolvedValue({ audioUrl: 'https://cdn.example.com/vo.mp3', durationMs: 8000 });
  mockComposeMusic.mockResolvedValue({ audio: Buffer.from('mp3'), lengthMs: 35000 });
  mockDbInsert.mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: { id: 'track-new', name: 'Generated · celebratory · 2026-06-09', file_url: 'https://cdn.example.com/music/track-new.mp3', mood_tag: 'celebratory', source: 'elevenlabs_music' },
        error: null,
      }),
    }),
  });
  mockDbStorage.mockReturnValue({
    upload: vi.fn().mockResolvedValue({ error: null }),
    getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/music/track-new.mp3' } }),
  });
  // Default chain for supabase (flip_winner update + generate_script address select)
  mockDbSelect.mockReturnValue({
    eq: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({ data: { address: '470 Sorrento Ct' }, error: null }),
    }),
  });
  mockDbUpdate.mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) });
  mockDbFrom.mockImplementation((table: string) => {
    if (table === 'properties') return { select: mockDbSelect };
    if (table === 'music_tracks') return { insert: mockDbInsert };
    return { update: mockDbUpdate };
  });
  mockParseFeedbackComment.mockResolvedValue({ tags: [{ category: 'pacing', sentiment: 'negative', note: 'felt rushed' }] });
  mockAdvanceRun.mockResolvedValue({ ...run, stage: 'delivered' });
});

describe('GET /api/admin/studio/delivery/[runId]', () => {
  it('GET returns the run bundle', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: { runId: 'r1' }, headers: {}, body: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect((res._body as { run: unknown }).run).toEqual(run);
  });

  it('GET bundle exposes paired_scene_ids (drives the Checkpoint A regenerate model picker)', async () => {
    mockGetPairedSceneIds.mockResolvedValue(['s-paired-1', 's-paired-2']);
    const res = makeRes();
    await handler({ method: 'GET', query: { runId: 'r1' }, headers: {}, body: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect(mockGetPairedSceneIds).toHaveBeenCalledWith('p1');
    expect((res._body as { paired_scene_ids: string[] }).paired_scene_ids).toEqual(['s-paired-1', 's-paired-2']);
  });

  it('GET 404s on unknown run', async () => {
    mockGetRun.mockResolvedValue(null);
    const res = makeRes();
    await handler({ method: 'GET', query: { runId: 'rX' }, headers: {}, body: {} } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(404);
  });
});

describe('POST /api/admin/studio/delivery/[runId]', () => {
  it('POST advance delegates to advanceRun', async () => {
    mockAdvanceRun.mockResolvedValue({ ...run, stage: 'details' });
    const res = makeRes();
    await handler({ method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'advance', to: 'details' } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(mockAdvanceRun).toHaveBeenCalledWith('r1', 'details');
    expect(res._status).toBe(200);
  });

  it('POST advance surfaces illegal transitions as 400', async () => {
    mockAdvanceRun.mockRejectedValue(new Error('advanceRun: illegal transition checkpoint_a -> music'));
    const res = makeRes();
    await handler({ method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'advance', to: 'music' } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(400);
  });

  it('POST advance surfaces stage-moved conflict as 409', async () => {
    mockAdvanceRun.mockRejectedValue(new Error('advanceRun: stage moved (expected judging)'));
    const res = makeRes();
    await handler({ method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'advance', to: 'checkpoint_a' } } as unknown as VercelRequest, res as unknown as VercelResponse);
    expect(res._status).toBe(409);
  });

  it('POST unknown action -> 400', async () => {
    const res1 = makeRes();
    await handler({ method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'nope' } } as unknown as VercelRequest, res1 as unknown as VercelResponse);
    expect(res1._status).toBe(400);
  });

  it('POST reorder -> 200, calls updateRun + recordMlEvent with before/after', async () => {
    mockGetRun.mockResolvedValue({ ...run, scene_order: ['s1', 's2'] });
    mockUpdateRun.mockResolvedValue({ ...run, scene_order: ['s2', 's1'] });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'reorder', scene_order: ['s2', 's1'] } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockUpdateRun).toHaveBeenCalledWith('r1', { scene_order: ['s2', 's1'] });
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'reorder', { before: ['s1', 's2'], after: ['s2', 's1'] });
  });

  it('POST reorder with wrong id set -> 400', async () => {
    mockGetRun.mockResolvedValue({ ...run, scene_order: ['s1', 's2'] });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'reorder', scene_order: ['s1', 's3'] } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
  });

  it('POST flip_winner -> 200 and calls recordMlEvent with variant_override', async () => {
    const aVariant = { id: 'va1', scene_id: 's1', variant: 'A', clip_url: 'a.mp4', winner: true, winner_source: 'gemini' };
    const bVariant = { id: 'vb1', scene_id: 's1', variant: 'B', clip_url: 'b.mp4', winner: false, winner_source: 'gemini' };
    mockGetVariantsForRun.mockResolvedValue([aVariant, bVariant]);
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'flip_winner', scene_id: 's1' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'variant_override', expect.objectContaining({ scene_id: 's1' }));
  });

  it('POST regenerate -> 200 and calls recordMlEvent with regenerate', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'regenerate', scene_id: 's1', variant: 'B' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRegenerateVariant).toHaveBeenCalledWith('r1', 's1', 'B');
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'regenerate', expect.objectContaining({ scene_id: 's1', variant: 'B' }));
  });

  it('POST regenerate without model does not include a model field in the ml_event payload', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'regenerate', scene_id: 's1', variant: 'A' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const regenCall = mockRecordMlEvent.mock.calls.find((c: unknown[]) => c[1] === 'regenerate');
    expect(regenCall?.[2]).not.toHaveProperty('model');
  });
});

describe('POST regenerate — paired-scene model choice (seedance-pair opt-in)', () => {
  /** Points the mocked scenes table at a row with the given end_photo_id. */
  function setSceneEndPhoto(endPhotoId: string | null) {
    mockDbFrom.mockImplementation((table: string) => {
      if (table === 'scenes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { end_photo_id: endPhotoId }, error: null }),
            }),
          }),
        };
      }
      if (table === 'properties') return { select: mockDbSelect };
      if (table === 'music_tracks') return { insert: mockDbInsert };
      return { update: mockDbUpdate };
    });
  }

  it('model=seedance-pair on a paired scene -> 200, threads modelOverride + records model in ml_event', async () => {
    setSceneEndPhoto('photo-end-1');
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'regenerate', scene_id: 's1', variant: 'A', model: 'seedance-pair' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRegenerateVariant).toHaveBeenCalledWith('r1', 's1', 'A', { modelOverride: 'seedance-pair' });
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'regenerate', { scene_id: 's1', variant: 'A', model: 'seedance-pair' });
  });

  it('model=kling-v3-pro -> 200, threads modelOverride + records model in ml_event', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'regenerate', scene_id: 's1', variant: 'B', model: 'kling-v3-pro' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRegenerateVariant).toHaveBeenCalledWith('r1', 's1', 'B', { modelOverride: 'kling-v3-pro' });
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'regenerate', { scene_id: 's1', variant: 'B', model: 'kling-v3-pro' });
  });

  it('model outside the allowlist -> 400, no regenerate fired', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'regenerate', scene_id: 's1', variant: 'A', model: 'seedance-pro-pushin' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/not allowed/);
    expect(mockRegenerateVariant).not.toHaveBeenCalled();
    expect(mockRecordMlEvent).not.toHaveBeenCalled();
  });

  it('model=seedance-pair on a NON-paired scene (no end_photo_id) -> 400 with a clear message', async () => {
    setSceneEndPhoto(null);
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'regenerate', scene_id: 's1', variant: 'A', model: 'seedance-pair' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/paired scene/);
    expect(mockRegenerateVariant).not.toHaveBeenCalled();
    expect(mockRecordMlEvent).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/studio/delivery/[runId]', () => {
  it('PATCH with valid payload -> 200, calls setListingDetails + recordMlEvent', async () => {
    const res = makeRes();
    await handler(
      { method: 'PATCH', query: { runId: 'r1' }, headers: {}, body: { price: 899000 } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockSetListingDetails).toHaveBeenCalledWith('r1', { price: 899000, source: 'manual' });
    expect(mockRecordMlEvent).toHaveBeenCalledWith(
      'r1',
      'details_edit',
      expect.objectContaining({ before: run.listing_details, after: { price: 899000, source: 'manual' } }),
    );
  });

  it('PATCH with invalid payload -> 400', async () => {
    mockValidateListingDetails.mockReturnValue({ ok: false, error: 'price must be a non-negative number' });
    const res = makeRes();
    await handler(
      { method: 'PATCH', query: { runId: 'r1' }, headers: {}, body: { price: -1 } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect(mockSetListingDetails).not.toHaveBeenCalled();
    expect(mockRecordMlEvent).not.toHaveBeenCalled();
  });

  it('PATCH with unknown runId -> 404', async () => {
    mockGetRun.mockResolvedValue(null);
    const res = makeRes();
    await handler(
      { method: 'PATCH', query: { runId: 'rX' }, headers: {}, body: { price: 899000 } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(404);
  });
});

describe('POST generate_script + set_script (T17)', () => {
  it('POST generate_script -> 200, calls generateDeliveryScript + updateRun with script', async () => {
    mockGetRun.mockResolvedValue({ ...run, video_type: 'just_listed', duration_seconds: 30, listing_details: { price: 899000 } });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_script' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockGenerateDeliveryScript).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'r1',
      propertyId: 'p1',
      videoType: 'just_listed',
      durationSec: 30,
    }));
    expect(mockUpdateRun).toHaveBeenCalledWith('r1', expect.objectContaining({ voiceover_script: 'Welcome to X St.' }));
  });

  it('POST generate_script -> 404 on unknown run', async () => {
    mockGetRun.mockResolvedValue(null);
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'rX' }, headers: {}, body: { action: 'generate_script' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(404);
    expect(mockGenerateDeliveryScript).not.toHaveBeenCalled();
  });

  it('POST set_script -> 200, calls updateRun with the new script and records script_edit ml_event', async () => {
    mockGetRun.mockResolvedValue({ ...run, voiceover_script: 'Old script.' });
    mockUpdateRun.mockResolvedValue({ ...run, voiceover_script: 'New script.' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'set_script', script: 'New script.' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockUpdateRun).toHaveBeenCalledWith('r1', expect.objectContaining({ voiceover_script: 'New script.' }));
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'script_edit', { before: 'Old script.', after: 'New script.' });
  });

  it('POST set_script with empty body -> 400', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'set_script', script: '' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });

  it('POST set_script does NOT record ml_event when script is unchanged', async () => {
    mockGetRun.mockResolvedValue({ ...run, voiceover_script: 'Same script.' });
    mockUpdateRun.mockResolvedValue({ ...run, voiceover_script: 'Same script.' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'set_script', script: 'Same script.' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRecordMlEvent).not.toHaveBeenCalled();
  });
});

describe('POST set_voice + generate_audio (T18)', () => {
  it('POST set_voice -> 200, stores voice_id + records voice_choice ml_event', async () => {
    const voiceId = 'UgBBYS2sOqTuMpoF3BR0';
    mockUpdateRun.mockResolvedValue({ ...run, voiceover_voice_id: voiceId });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'set_voice', voice_id: voiceId, is_client_voice: false } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockUpdateRun).toHaveBeenCalledWith('r1', expect.objectContaining({ voiceover_voice_id: voiceId }));
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'voice_choice', { voice_id: voiceId, is_client_voice: false });
  });

  it('POST set_voice with is_client_voice=true sets flag correctly', async () => {
    const voiceId = 'kdmDKE6EkgrWrrykO9Qt';
    mockUpdateRun.mockResolvedValue({ ...run, voiceover_voice_id: voiceId });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'set_voice', voice_id: voiceId, is_client_voice: true } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'voice_choice', { voice_id: voiceId, is_client_voice: true });
  });

  it('POST set_voice without voice_id -> 400', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'set_voice', voice_id: '' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });

  it('POST generate_audio -> 200, calls generateVoiceoverAudio + updateRun with audioUrl', async () => {
    const runWithVO = { ...run, voiceover_script: 'Great home!', voiceover_voice_id: 'UgBBYS2sOqTuMpoF3BR0', property_id: 'p1' };
    mockGetRun.mockResolvedValue(runWithVO);
    mockUpdateRun.mockResolvedValue({ ...runWithVO, voiceover_audio_url: 'https://cdn.example.com/vo.mp3' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_audio' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockGenerateVoiceoverAudio).toHaveBeenCalledWith(expect.objectContaining({
      script: 'Great home!',
      voiceId: 'UgBBYS2sOqTuMpoF3BR0',
      propertyId: 'p1',
    }));
    expect(mockUpdateRun).toHaveBeenCalledWith('r1', expect.objectContaining({ voiceover_audio_url: 'https://cdn.example.com/vo.mp3' }));
  });

  it('POST generate_audio without script -> 400', async () => {
    mockGetRun.mockResolvedValue({ ...run, voiceover_script: null, voiceover_voice_id: 'UgBBYS2sOqTuMpoF3BR0' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_audio' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect(mockGenerateVoiceoverAudio).not.toHaveBeenCalled();
  });

  it('POST generate_audio without voice_id -> 400', async () => {
    mockGetRun.mockResolvedValue({ ...run, voiceover_script: 'A script.', voiceover_voice_id: null });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_audio' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect(mockGenerateVoiceoverAudio).not.toHaveBeenCalled();
  });

  it('POST generate_audio -> 502 + setRunError on two consecutive failures', async () => {
    mockGetRun.mockResolvedValue({ ...run, voiceover_script: 'A script.', voiceover_voice_id: 'UgBBYS2sOqTuMpoF3BR0', property_id: 'p1' });
    mockGenerateVoiceoverAudio.mockRejectedValue(new Error('ElevenLabs TTS failed (500): server error'));
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_audio' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(502);
    expect(mockSetRunError).toHaveBeenCalledWith('r1', expect.stringContaining('Voiceover audio failed twice'));
  });
});

describe('POST generate_audio auto-shorten (duration audit)', () => {
  const overrunRun = {
    ...run,
    voiceover_script: 'A long original script with far too many words in it.',
    voiceover_voice_id: 'UgBBYS2sOqTuMpoF3BR0',
    property_id: 'p1',
    duration_seconds: 30,
  };

  beforeEach(() => {
    mockGetRun.mockResolvedValue(overrunRun);
  });

  it('overrun audio -> shortens, regenerates, persists the shortened script with the new audio, no warning', async () => {
    mockGenerateVoiceoverAudio
      .mockResolvedValueOnce({ audioUrl: 'https://cdn.example.com/vo-long.mp3', durationMs: 35000 })
      .mockResolvedValueOnce({ audioUrl: 'https://cdn.example.com/vo-short.mp3', durationMs: 29000 });
    mockShortenDeliveryScript.mockResolvedValue({ script: 'A short script.' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_audio' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockUpdateRun).toHaveBeenCalledWith('r1', { voiceover_script: 'A short script.', voiceover_audio_url: 'https://cdn.example.com/vo-short.mp3' });
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'script_edit', expect.objectContaining({ source: 'auto_shorten', target_seconds: 30 }));
    expect((res._body as { duration_warning?: string }).duration_warning).toBeUndefined();
  });

  it('shortenDeliveryScript failure keeps the last good audio: 200 + persists original script/audio + auto-shorten-unavailable warning', async () => {
    mockGenerateVoiceoverAudio.mockResolvedValue({ audioUrl: 'https://cdn.example.com/vo-long.mp3', durationMs: 35000 });
    mockShortenDeliveryScript.mockRejectedValue(new Error('Claude overloaded'));
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_audio' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockUpdateRun).toHaveBeenCalledWith('r1', { voiceover_script: overrunRun.voiceover_script, voiceover_audio_url: 'https://cdn.example.com/vo-long.mp3' });
    expect((res._body as { duration_warning?: string }).duration_warning).toContain('(auto-shorten unavailable)');
    expect(mockSetRunError).not.toHaveBeenCalled();
    // No partial state: the shorten never produced audio, so no script_edit event.
    expect(mockRecordMlEvent).not.toHaveBeenCalled();
  });

  it('regenerate failure after a successful shorten keeps the last good {script, audio} pair (never the shortened script with old audio)', async () => {
    mockGenerateVoiceoverAudio
      .mockResolvedValueOnce({ audioUrl: 'https://cdn.example.com/vo-long.mp3', durationMs: 35000 })
      .mockRejectedValue(new Error('ElevenLabs TTS failed (500): server error')); // both regen attempts fail
    mockShortenDeliveryScript.mockResolvedValue({ script: 'A short script.' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_audio' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockUpdateRun).toHaveBeenCalledWith('r1', { voiceover_script: overrunRun.voiceover_script, voiceover_audio_url: 'https://cdn.example.com/vo-long.mp3' });
    expect((res._body as { duration_warning?: string }).duration_warning).toContain('(auto-shorten unavailable)');
    expect(mockSetRunError).not.toHaveBeenCalled();
    expect(mockRecordMlEvent).not.toHaveBeenCalled();
  });

  it('still over after 2 successful shorten passes -> plain duration warning (no unavailable suffix)', async () => {
    mockGenerateVoiceoverAudio.mockResolvedValue({ audioUrl: 'https://cdn.example.com/vo-long.mp3', durationMs: 35000 });
    mockShortenDeliveryScript.mockResolvedValue({ script: 'Still a bit long.' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_audio' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockShortenDeliveryScript).toHaveBeenCalledTimes(2);
    const warning = (res._body as { duration_warning?: string }).duration_warning;
    expect(warning).toContain('35.0s > 30s target');
    expect(warning).not.toContain('auto-shorten unavailable');
  });
});

describe('POST set_music + generate_music (T19)', () => {
  it('POST set_music -> 200, stores music_track_id + records music_choice ml_event', async () => {
    const trackId = 'track-abc';
    mockUpdateRun.mockResolvedValue({ ...run, music_track_id: trackId });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'set_music', music_track_id: trackId, source: 'library' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockUpdateRun).toHaveBeenCalledWith('r1', expect.objectContaining({ music_track_id: trackId }));
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'music_choice', { music_track_id: trackId, source: 'library' });
  });

  it('POST set_music with source=generated records correct source', async () => {
    const trackId = 'track-generated';
    mockUpdateRun.mockResolvedValue({ ...run, music_track_id: trackId });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'set_music', music_track_id: trackId, source: 'generated' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'music_choice', { music_track_id: trackId, source: 'generated' });
  });

  it('POST set_music without music_track_id -> 400', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'set_music', music_track_id: '' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });

  it('POST generate_music -> 201, calls composeMusic, uploads + inserts track', async () => {
    mockGetRun.mockResolvedValue({ ...run, video_type: 'just_closed', duration_seconds: 30, property_id: 'p1' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_music' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(201);
    expect(mockComposeMusic).toHaveBeenCalledWith(
      'celebratory prompt',
      expect.any(Number),
      expect.objectContaining({ propertyId: 'p1' }),
    );
    const body = res._body as { track: { id: string } };
    expect(body.track.id).toBe('track-new');
  });

  it('POST generate_music -> 404 on unknown run', async () => {
    mockGetRun.mockResolvedValue(null);
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'rX' }, headers: {}, body: { action: 'generate_music' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(404);
    expect(mockComposeMusic).not.toHaveBeenCalled();
  });

  it('POST generate_music -> 502 + setRunError on compose failure', async () => {
    mockGetRun.mockResolvedValue({ ...run, video_type: 'just_listed', duration_seconds: 30, property_id: 'p1' });
    mockComposeMusic.mockRejectedValue(new Error('ElevenLabs Music failed (500): server error'));
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_music' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(502);
    expect(mockSetRunError).toHaveBeenCalledWith('r1', expect.stringContaining('Music generation failed'));
  });
});

describe('POST assemble (T20)', () => {
  it('POST assemble from music stage -> advances to assembling, runs the assemble stage, returns updated run', async () => {
    const musicRun = { ...run, stage: 'music' };
    const assembledRun = { ...run, stage: 'checkpoint_b' };
    mockGetRun.mockResolvedValueOnce(musicRun).mockResolvedValueOnce(assembledRun);
    mockAdvanceRun.mockResolvedValue({ ...run, stage: 'assembling' });
    mockRunAssembleStage.mockResolvedValue(undefined);
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'assemble' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockAdvanceRun).toHaveBeenCalledWith('r1', 'assembling');
    expect(mockRunAssembleStage).toHaveBeenCalledWith('r1');
    expect((res._body as { run: { stage: string } }).run.stage).toBe('checkpoint_b');
  });

  it('POST assemble from assembling stage (retry) skips the advance and re-fires the stage', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'assembling' });
    mockRunAssembleStage.mockResolvedValue(undefined);
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'assemble' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockAdvanceRun).not.toHaveBeenCalled();
    expect(mockRunAssembleStage).toHaveBeenCalledWith('r1');
  });

  it('POST assemble -> 404 on unknown run', async () => {
    mockGetRun.mockResolvedValue(null);
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'rX' }, headers: {}, body: { action: 'assemble' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(404);
    expect(mockRunAssembleStage).not.toHaveBeenCalled();
  });
});

describe('POST submit_ratings (T21)', () => {
  const checkpointBRun = { id: 'r1', property_id: 'p1', stage: 'checkpoint_b' };

  it('POST submit_ratings -> 200, calls recordMlEvent(rating) + recordMlEvent(comment) + advanceRun(delivered)', async () => {
    mockGetRun.mockResolvedValue(checkpointBRun);
    const res = makeRes();
    await handler(
      {
        method: 'POST', query: { runId: 'r1' }, headers: {}, body: {
          action: 'submit_ratings', overall: 4, music: 5, voiceover: 3, script: 4, comment: 'pacing felt rushed',
        },
      } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'rating', { overall: 4, music: 5, voiceover: 3, script: 4 });
    // Clean parse: no parse_error field in the comment event payload
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'comment', expect.objectContaining({ raw: 'pacing felt rushed' }));
    const commentCall = mockRecordMlEvent.mock.calls.find((c: unknown[]) => c[1] === 'comment');
    expect(commentCall?.[2]).not.toHaveProperty('parse_error');
    expect(mockAdvanceRun).toHaveBeenCalledWith('r1', 'delivered');
  });

  it('POST submit_ratings comment parse failure -> parse_error:true in comment ml_event payload', async () => {
    mockGetRun.mockResolvedValue(checkpointBRun);
    mockParseFeedbackComment.mockResolvedValue({ tags: [], parse_error: true, error_message: 'JSON parse error' });
    const res = makeRes();
    await handler(
      {
        method: 'POST', query: { runId: 'r1' }, headers: {}, body: {
          action: 'submit_ratings', overall: 4, music: 5, voiceover: 3, script: 4, comment: 'junk response from model',
        },
      } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const commentCall = mockRecordMlEvent.mock.calls.find((c: unknown[]) => c[1] === 'comment');
    expect(commentCall?.[2]).toEqual(expect.objectContaining({ raw: 'junk response from model', tags: [], parse_error: true }));
    expect(mockAdvanceRun).toHaveBeenCalledWith('r1', 'delivered');
  });

  it('POST submit_ratings parseFeedbackComment throws -> parse_error:true in comment ml_event payload', async () => {
    mockGetRun.mockResolvedValue(checkpointBRun);
    mockParseFeedbackComment.mockRejectedValue(new Error('network failure'));
    const res = makeRes();
    await handler(
      {
        method: 'POST', query: { runId: 'r1' }, headers: {}, body: {
          action: 'submit_ratings', overall: 4, music: 5, voiceover: 3, script: 4, comment: 'great video',
        },
      } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const commentCall = mockRecordMlEvent.mock.calls.find((c: unknown[]) => c[1] === 'comment');
    expect(commentCall?.[2]).toEqual(expect.objectContaining({ raw: 'great video', tags: [], parse_error: true, error_message: 'network failure' }));
    expect(mockAdvanceRun).toHaveBeenCalledWith('r1', 'delivered');
  });

  it('POST submit_ratings with a rating outside 1-5 -> 400', async () => {
    mockGetRun.mockResolvedValue(checkpointBRun);
    const res = makeRes();
    await handler(
      {
        method: 'POST', query: { runId: 'r1' }, headers: {}, body: {
          action: 'submit_ratings', overall: 0, music: 5, voiceover: 3, script: 4,
        },
      } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect(mockRecordMlEvent).not.toHaveBeenCalled();
  });

  it('POST submit_ratings with empty comment skips the comment ml_event', async () => {
    mockGetRun.mockResolvedValue(checkpointBRun);
    const res = makeRes();
    await handler(
      {
        method: 'POST', query: { runId: 'r1' }, headers: {}, body: {
          action: 'submit_ratings', overall: 5, music: 5, voiceover: 5, script: 5, comment: '',
        },
      } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'rating', expect.any(Object));
    expect(mockRecordMlEvent).not.toHaveBeenCalledWith('r1', 'comment', expect.anything());
    expect(mockAdvanceRun).toHaveBeenCalledWith('r1', 'delivered');
  });

  it('POST submit_ratings -> 404 on unknown run', async () => {
    mockGetRun.mockResolvedValue(null);
    const res = makeRes();
    await handler(
      {
        method: 'POST', query: { runId: 'rX' }, headers: {}, body: {
          action: 'submit_ratings', overall: 4, music: 4, voiceover: 4, script: 4,
        },
      } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(404);
  });
});

describe('unsupported methods', () => {
  it('PUT -> 405', async () => {
    const res2 = makeRes();
    await handler({ method: 'PUT', query: { runId: 'r1' }, headers: {}, body: {} } as unknown as VercelRequest, res2 as unknown as VercelResponse);
    expect(res2._status).toBe(405);
  });
});
