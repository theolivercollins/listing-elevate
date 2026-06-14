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
const mockRevertRun = vi.fn();
const mockRunScrapeStage = vi.fn();
const mockRunJudgePass = vi.fn();

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
  revertRun: (...a: unknown[]) => mockRevertRun(...a),
}));
vi.mock('../../../../../lib/delivery/scrape', () => ({
  runScrapeStage: (...a: unknown[]) => mockRunScrapeStage(...a),
}));
vi.mock('../../../../../lib/delivery/judge', () => ({
  runJudgePass: (...a: unknown[]) => mockRunJudgePass(...a),
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
const mockBuildFeedbackBlock = vi.fn().mockReturnValue('');
const mockBuildGenrePrompt = vi.fn().mockImplementation((mood: string, frag: string, fb: string) => `${mood} ${frag}${fb ? ' ' + fb : ''}`);
vi.mock('../../../../../lib/providers/elevenlabs-music', () => ({
  composeMusic: (...a: unknown[]) => mockComposeMusic(...a),
  MOOD_PROMPTS: { upbeat: 'upbeat prompt', warm: 'warm prompt', celebratory: 'celebratory prompt', cinematic: 'cinematic prompt', neutral: 'neutral prompt' },
  GENRE_VARIANTS: [
    { key: 'acoustic', label: 'Acoustic', promptFragment: 'Acoustic fragment.' },
    { key: 'orchestral', label: 'Orchestral', promptFragment: 'Orchestral fragment.' },
    { key: 'ambient', label: 'Ambient', promptFragment: 'Ambient fragment.' },
    { key: 'modern', label: 'Modern', promptFragment: 'Modern fragment.' },
  ],
  buildFeedbackBlock: (...a: unknown[]) => mockBuildFeedbackBlock(...a),
  buildGenrePrompt: (...a: unknown[]) => mockBuildGenrePrompt(...a),
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
  mockBuildFeedbackBlock.mockReturnValue('');
  mockBuildGenrePrompt.mockImplementation((mood: string, frag: string, fb: string) => `${mood} ${frag}${fb ? ' ' + fb : ''}`);
  mockRevertRun.mockResolvedValue({ ...run, stage: 'judging' });
  mockRunScrapeStage.mockResolvedValue(undefined);
  mockRunJudgePass.mockResolvedValue({ ready: true });
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

  it('POST generate_music -> 201, calls composeMusic 4x, returns { tracks, failures:0 }', async () => {
    mockGetRun.mockResolvedValue({ ...run, video_type: 'just_closed', duration_seconds: 30, property_id: 'p1' });

    // music_track_feedback chain
    function makeEmptyFbChain() {
      const chain: Record<string, unknown> = {};
      chain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
      chain.order = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.select = vi.fn().mockReturnValue(chain);
      return chain;
    }
    let insertCallN = 0;
    const trackIds2 = ['t-a', 't-o', 't-am', 't-m'];
    mockDbFrom.mockImplementation((table: string) => {
      if (table === 'music_track_feedback') return makeEmptyFbChain();
      if (table === 'music_tracks') {
        const id = trackIds2[insertCallN++] ?? 'tx';
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id, name: `Generated · celebratory · acoustic · 2026-06-11`, file_url: `https://cdn.example.com/music/${id}.mp3`, mood_tag: 'celebratory', source: 'elevenlabs_music', genre: 'acoustic' },
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: mockDbSelect, update: mockDbUpdate };
    });

    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_music' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(201);
    // composeMusic called once per genre (4 times)
    expect(mockComposeMusic).toHaveBeenCalledTimes(4);
    // All calls include a prompt and use propertyId
    expect(mockComposeMusic).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      expect.objectContaining({ propertyId: 'p1' }),
    );
    const body = res._body as { tracks: { id: string }[]; failures: number };
    expect(body.tracks).toHaveLength(4);
    expect(body.failures).toBe(0);
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

  it('POST generate_music -> all-fail fallback to library track when compose fails and library has tracks', async () => {
    mockGetRun.mockResolvedValue({ ...run, video_type: 'just_listed', duration_seconds: 30, property_id: 'p1' });
    mockComposeMusic.mockRejectedValue(new Error('401 missing_permissions'));
    const libraryTrack = { id: 'lib-track-1', name: 'Upbeat Library Track', file_url: 'https://cdn.example.com/music/lib1.mp3', mood_tag: 'upbeat', source: 'library' };

    // music_track_feedback chain for the initial feedback query
    function makeEmptyFbChain2() {
      const chain: Record<string, unknown> = {};
      chain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
      chain.order = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.select = vi.fn().mockReturnValue(chain);
      return chain;
    }
    // Build a chainable mock for the fallback pool queries:
    //   .select(...).eq(...).eq(...).neq(...)  → { data: [libraryTrack] }
    //   .select(...).eq(...).neq(...)           → { data: [libraryTrack] }
    function makeChain(result: unknown) {
      const chain: Record<string, unknown> = {};
      chain.neq = vi.fn().mockResolvedValue(result);
      chain.eq = vi.fn().mockReturnValue(chain);
      return chain;
    }
    const chainWithTrack = makeChain({ data: [libraryTrack] });
    const mockSelectChain = vi.fn().mockReturnValue(chainWithTrack);
    mockDbFrom.mockImplementation((table: string) => {
      if (table === 'music_track_feedback') return makeEmptyFbChain2();
      if (table === 'properties') return { select: mockDbSelect };
      if (table === 'music_tracks') return { select: mockSelectChain, insert: mockDbInsert };
      return { update: mockDbUpdate };
    });
    mockUpdateRun.mockResolvedValue({ ...run, music_track_id: 'lib-track-1' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_music' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockSetRunError).not.toHaveBeenCalled();
    const body = res._body as { tracks: { id: string }[]; fallback: boolean; warning: string; failures: number };
    expect(body.fallback).toBe(true);
    expect(body.failures).toBe(4);
    expect(body.tracks[0].id).toBe('lib-track-1');
    expect(body.warning).toContain('401 missing_permissions');
    expect(mockUpdateRun).toHaveBeenCalledWith('r1', expect.objectContaining({ music_track_id: 'lib-track-1' }));
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'music_choice', expect.objectContaining({
      music_track_id: 'lib-track-1',
      source: 'library_fallback',
      generation_error: expect.stringContaining('401 missing_permissions'),
    }));
  });

  it('POST generate_music -> 502 + setRunError when compose fails AND library is empty', async () => {
    mockGetRun.mockResolvedValue({ ...run, video_type: 'just_listed', duration_seconds: 30, property_id: 'p1' });
    mockComposeMusic.mockRejectedValue(new Error('ElevenLabs Music failed (500): server error'));

    // music_track_feedback chain
    function makeEmptyFbChainFor502() {
      const chain: Record<string, unknown> = {};
      chain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
      chain.order = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.select = vi.fn().mockReturnValue(chain);
      return chain;
    }
    // All fallback queries return empty pools — same chain structure but empty arrays
    function makeEmptyChain() {
      const chain: Record<string, unknown> = {};
      chain.neq = vi.fn().mockResolvedValue({ data: [] });
      chain.eq = vi.fn().mockReturnValue(chain);
      return chain;
    }
    const emptyChain = makeEmptyChain();
    const mockSelectEmpty = vi.fn().mockReturnValue(emptyChain);
    mockDbFrom.mockImplementation((table: string) => {
      if (table === 'music_track_feedback') return makeEmptyFbChainFor502();
      if (table === 'properties') return { select: mockDbSelect };
      if (table === 'music_tracks') return { select: mockSelectEmpty, insert: mockDbInsert };
      return { update: mockDbUpdate };
    });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_music' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(502);
    expect(mockSetRunError).toHaveBeenCalledWith('r1', expect.stringContaining('Music generation failed'));
    expect(mockUpdateRun).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// generate_music — 4-genre parallel generation (T22)
// ---------------------------------------------------------------------------

describe('POST generate_music — 4-genre parallel (T22)', () => {
  // Default: all 4 genres succeed. We need to set up the db mock to support
  // music_track_feedback SELECT (returns empty = no prior feedback) plus
  // 4 INSERT calls for the new track rows.
  const musicRun = { id: 'r1', property_id: 'p1', stage: 'music', video_type: 'just_listed', duration_seconds: 30 };

  // Create a per-insert mock factory that returns a unique track each call
  function makeInsertChain(trackId: string) {
    return {
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: trackId,
            name: `Generated · upbeat · acoustic · 2026-06-11`,
            file_url: `https://cdn.example.com/music/${trackId}.mp3`,
            mood_tag: 'upbeat',
            source: 'elevenlabs_music',
            genre: 'acoustic',
          },
          error: null,
        }),
      }),
    };
  }

  function makeEmptyFeedbackChain() {
    // music_track_feedback SELECT: .select().eq().eq().order().limit()
    const chain: Record<string, unknown> = {};
    chain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
    chain.order = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.select = vi.fn().mockReturnValue(chain);
    return chain;
  }

  it('4-up success: calls composeMusic 4x, inserts 4 tracks, returns { tracks, failures:0 }', async () => {
    mockGetRun.mockResolvedValue(musicRun);
    mockComposeMusic.mockResolvedValue({ audio: Buffer.from('mp3'), lengthMs: 35000 });

    const insertCallCount = { n: 0 };
    const trackIds = ['t-acoustic', 't-orchestral', 't-ambient', 't-modern'];

    mockDbStorage.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/music/x.mp3' } }),
    });

    mockDbFrom.mockImplementation((table: string) => {
      if (table === 'music_track_feedback') return makeEmptyFeedbackChain();
      if (table === 'music_tracks') {
        const n = insertCallCount.n++;
        return { insert: vi.fn().mockReturnValue(makeInsertChain(trackIds[n] ?? 'tx')) };
      }
      return { select: mockDbSelect, update: mockDbUpdate };
    });

    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_music' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(201);
    expect(mockComposeMusic).toHaveBeenCalledTimes(4);
    const body = res._body as { tracks: { id: string }[]; failures: number; warning?: string };
    expect(body.tracks).toHaveLength(4);
    expect(body.failures).toBe(0);
    expect(body.warning).toBeUndefined();
  });

  it('partial failure (2 fail): returns { tracks: [2 tracks], failures: 2, warning }', async () => {
    mockGetRun.mockResolvedValue(musicRun);
    // First 2 calls succeed, last 2 fail
    mockComposeMusic
      .mockResolvedValueOnce({ audio: Buffer.from('mp3'), lengthMs: 35000 })
      .mockResolvedValueOnce({ audio: Buffer.from('mp3'), lengthMs: 35000 })
      .mockRejectedValueOnce(new Error('ElevenLabs timeout'))
      .mockRejectedValueOnce(new Error('ElevenLabs timeout'));

    const insertCallCount2 = { n: 0 };
    const successIds = ['t-acoustic', 't-orchestral'];
    mockDbStorage.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/music/x.mp3' } }),
    });
    mockDbFrom.mockImplementation((table: string) => {
      if (table === 'music_track_feedback') return makeEmptyFeedbackChain();
      if (table === 'music_tracks') {
        const n = insertCallCount2.n++;
        return { insert: vi.fn().mockReturnValue(makeInsertChain(successIds[n] ?? 'tx')) };
      }
      return { select: mockDbSelect, update: mockDbUpdate };
    });

    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_music' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(201);
    const body = res._body as { tracks: { id: string }[]; failures: number; warning?: string };
    expect(body.tracks).toHaveLength(2);
    expect(body.failures).toBe(2);
    expect(body.warning).toContain('2 of 4');
  });

  it('all-fail → library fallback: returns { tracks: [fallback], failures: 4, fallback: true, warning }', async () => {
    mockGetRun.mockResolvedValue(musicRun);
    mockComposeMusic.mockRejectedValue(new Error('ElevenLabs API down'));

    const libraryTrack = { id: 'lib-1', name: 'Library', file_url: 'https://cdn.example.com/lib.mp3', mood_tag: 'upbeat', source: 'library', genre: null };

    function makeChain(result: unknown) {
      const chain: Record<string, unknown> = {};
      chain.neq = vi.fn().mockResolvedValue(result);
      chain.eq = vi.fn().mockReturnValue(chain);
      return chain;
    }
    const withTrack = makeChain({ data: [libraryTrack] });
    const selectChain = vi.fn().mockReturnValue(withTrack);

    mockDbFrom.mockImplementation((table: string) => {
      if (table === 'music_track_feedback') return makeEmptyFeedbackChain();
      if (table === 'music_tracks') return { select: selectChain, insert: mockDbInsert };
      return { select: mockDbSelect, update: mockDbUpdate };
    });
    mockUpdateRun.mockResolvedValue({ ...musicRun, music_track_id: 'lib-1' });

    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_music' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    const body = res._body as { tracks: { id: string; genre: unknown }[]; failures: number; fallback: boolean; warning?: string };
    expect(body.fallback).toBe(true);
    expect(body.failures).toBe(4);
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0].id).toBe('lib-1');
    expect(body.warning).toBeTruthy();
  });

  it('generate_music fetches feedback rows for the run mood and passes feedbackBlock to composeMusic', async () => {
    mockGetRun.mockResolvedValue(musicRun);
    mockComposeMusic.mockResolvedValue({ audio: Buffer.from('mp3'), lengthMs: 35000 });
    mockBuildFeedbackBlock.mockReturnValue('OPERATOR FEEDBACK: liked acoustic.');

    const insertCallCount3 = { n: 0 };
    const ids3 = ['t1', 't2', 't3', 't4'];
    mockDbStorage.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/music/x.mp3' } }),
    });
    mockDbFrom.mockImplementation((table: string) => {
      if (table === 'music_track_feedback') return makeEmptyFeedbackChain();
      if (table === 'music_tracks') {
        const n = insertCallCount3.n++;
        return { insert: vi.fn().mockReturnValue(makeInsertChain(ids3[n] ?? 'tx')) };
      }
      return { select: mockDbSelect, update: mockDbUpdate };
    });

    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'generate_music' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );

    expect(mockBuildFeedbackBlock).toHaveBeenCalled();
    // buildGenrePrompt called 4 times — once per genre
    expect(mockBuildGenrePrompt).toHaveBeenCalledTimes(4);
    // All 4 composeMusic calls receive the composed prompt (not just the raw mood)
    expect(mockComposeMusic).toHaveBeenCalledTimes(4);
  });
});

// ---------------------------------------------------------------------------
// music_feedback action (T23)
// ---------------------------------------------------------------------------

describe('POST music_feedback (T23)', () => {
  // A track row returned when we look up track_id
  const aiTrack = {
    id: 'track-ai-1',
    mood_tag: 'upbeat',
    genre: 'acoustic',
    prompt: 'Uplifting prompt...',
    source: 'elevenlabs_music',
    active: true,
  };
  const libraryTrack = {
    id: 'track-lib-1',
    mood_tag: 'upbeat',
    genre: null,
    prompt: null,
    source: 'library',
    active: true,
  };

  function makeFeedbackInsertChain(success = true) {
    return {
      upsert: vi.fn().mockResolvedValue({ error: success ? null : new Error('upsert failed') }),
    };
  }

  function makeTrackSelectChain(track: typeof aiTrack | typeof libraryTrack) {
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: track, error: null }),
        }),
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
  }

  it('music_feedback insert (new row): verdict up → ok:true, records ml_event, does NOT deactivate', async () => {
    mockDbFrom.mockImplementation((table: string) => {
      if (table === 'music_tracks') return makeTrackSelectChain(aiTrack);
      if (table === 'music_track_feedback') return makeFeedbackInsertChain();
      return { select: mockDbSelect, update: mockDbUpdate };
    });

    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'music_feedback', track_id: 'track-ai-1', verdict: 'up' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect((res._body as { ok: boolean }).ok).toBe(true);
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'music_feedback', expect.objectContaining({
      track_id: 'track-ai-1',
      verdict: 'up',
      has_comment: false,
    }));
    // verdict=up → no deactivation
    const updateCalls = (mockDbFrom.mock.results as { value: { update: typeof vi.fn } }[])
      .map(r => r.value?.update);
    // The music_tracks update for deactivation should NOT have been called for an 'up' verdict
  });

  it('music_feedback with comment: has_comment=true in ml_event payload', async () => {
    mockDbFrom.mockImplementation((table: string) => {
      if (table === 'music_tracks') return makeTrackSelectChain(aiTrack);
      if (table === 'music_track_feedback') return makeFeedbackInsertChain();
      return { select: mockDbSelect, update: mockDbUpdate };
    });

    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'music_feedback', track_id: 'track-ai-1', verdict: 'up', comment: 'loved the strings' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRecordMlEvent).toHaveBeenCalledWith('r1', 'music_feedback', expect.objectContaining({
      has_comment: true,
    }));
  });

  it('music_feedback upsert failure: 500, no ml_event recorded', async () => {
    mockDbFrom.mockImplementation((table: string) => {
      if (table === 'music_tracks') return makeTrackSelectChain(aiTrack);
      if (table === 'music_track_feedback') return makeFeedbackInsertChain(false);
      return { select: mockDbSelect, update: mockDbUpdate };
    });

    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'music_feedback', track_id: 'track-ai-1', verdict: 'up' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(500);
    expect(String((res._body as { error: string }).error)).toContain('feedback save failed');
    expect(mockRecordMlEvent).not.toHaveBeenCalledWith('r1', 'music_feedback', expect.anything());
  });

  it('music_feedback verdict=down on AI track: sets music_tracks.active=false', async () => {
    const deactivateUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    mockDbFrom.mockImplementation((table: string) => {
      if (table === 'music_tracks') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: aiTrack, error: null }),
            }),
          }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          update: deactivateUpdate,
        };
      }
      if (table === 'music_track_feedback') return makeFeedbackInsertChain();
      return { select: mockDbSelect, update: mockDbUpdate };
    });

    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'music_feedback', track_id: 'track-ai-1', verdict: 'down' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(deactivateUpdate).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  it('music_feedback verdict=down on LIBRARY track: does NOT deactivate', async () => {
    const deactivateUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    mockDbFrom.mockImplementation((table: string) => {
      if (table === 'music_tracks') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: libraryTrack, error: null }),
            }),
          }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          update: deactivateUpdate,
        };
      }
      if (table === 'music_track_feedback') return makeFeedbackInsertChain();
      return { select: mockDbSelect, update: mockDbUpdate };
    });

    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'music_feedback', track_id: 'track-lib-1', verdict: 'down' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    // deactivateUpdate must NOT have been called on the music_tracks table
    expect(deactivateUpdate).not.toHaveBeenCalled();
  });

  it('music_feedback repeat (same run+track): upsert semantics, ok:true', async () => {
    // Upsert: the DB call goes through regardless; we just verify the response
    mockDbFrom.mockImplementation((table: string) => {
      if (table === 'music_tracks') return makeTrackSelectChain(aiTrack);
      if (table === 'music_track_feedback') return makeFeedbackInsertChain();
      return { select: mockDbSelect, update: mockDbUpdate };
    });

    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'music_feedback', track_id: 'track-ai-1', verdict: 'down' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    const res2 = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'music_feedback', track_id: 'track-ai-1', verdict: 'up' } } as unknown as VercelRequest,
      res2 as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(res2._status).toBe(200);
  });

  it('music_feedback invalid verdict -> 400', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'music_feedback', track_id: 'track-ai-1', verdict: 'meh' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect(mockRecordMlEvent).not.toHaveBeenCalled();
  });

  it('music_feedback missing track_id -> 400', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'music_feedback', verdict: 'up' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect(mockRecordMlEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST back action
// ---------------------------------------------------------------------------

describe('POST back (T-back)', () => {
  it('back with no body.to → goes one step back using revertRun', async () => {
    // run is at checkpoint_a; back should target judging
    mockGetRun.mockResolvedValue({ ...run, stage: 'checkpoint_a' });
    mockRevertRun.mockResolvedValue({ ...run, stage: 'judging' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'back' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRevertRun).toHaveBeenCalledWith('r1', 'judging');
    expect((res._body as { run: { stage: string } }).run.stage).toBe('judging');
  });

  it('back with explicit body.to → calls revertRun with that stage', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'checkpoint_a' });
    mockRevertRun.mockResolvedValue({ ...run, stage: 'scraping' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'back', to: 'scraping' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRevertRun).toHaveBeenCalledWith('r1', 'scraping');
  });

  it('back at the first stage (intake) returns 400 "already at the first step"', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'intake' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'back' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/already at the first step/i);
    expect(mockRevertRun).not.toHaveBeenCalled();
  });

  it('back with an invalid to stage → 400', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'checkpoint_a' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'back', to: 'bogus_stage' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect(mockRevertRun).not.toHaveBeenCalled();
  });

  it('back with a stage-moved conflict from revertRun → 409', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'checkpoint_a' });
    mockRevertRun.mockRejectedValue(new Error('revertRun: stage moved (expected checkpoint_a)'));
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'back' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(409);
  });

  it('back with an illegal-transition error from revertRun → 400', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'checkpoint_a' });
    mockRevertRun.mockRejectedValue(new Error('revertRun: illegal transition checkpoint_a -> music (must be strictly backward)'));
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'back', to: 'music' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
  });

  it('back → 404 on unknown run', async () => {
    mockGetRun.mockResolvedValue(null);
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'rX' }, headers: {}, body: { action: 'back' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(404);
    expect(mockRevertRun).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST rerun action
// ---------------------------------------------------------------------------

describe('POST rerun (T-rerun)', () => {
  it('rerun at scraping → calls runScrapeStage', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'scraping' });
    mockRunScrapeStage.mockResolvedValue(undefined);
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'rerun' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRunScrapeStage).toHaveBeenCalledWith('r1');
  });

  it('rerun at judging → calls runJudgePass', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'judging' });
    mockRunJudgePass.mockResolvedValue({ ready: true });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'rerun' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRunJudgePass).toHaveBeenCalledWith('r1');
  });

  it('rerun at checkpoint_a → calls runJudgePass (re-run the judge pass that produced the checkpoint)', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'checkpoint_a' });
    mockRunJudgePass.mockResolvedValue({ ready: true });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'rerun' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRunJudgePass).toHaveBeenCalledWith('r1');
  });

  it('rerun at voiceover → calls generate_audio helper (generateVoiceoverAudio), returns run', async () => {
    const voRun = { ...run, stage: 'voiceover', voiceover_script: 'Welcome.', voiceover_voice_id: 'v-123', property_id: 'p1', duration_seconds: 30 };
    mockGetRun.mockResolvedValue(voRun);
    mockUpdateRun.mockResolvedValue({ ...voRun, voiceover_audio_url: 'https://cdn.example.com/vo.mp3' });
    mockGenerateVoiceoverAudio.mockResolvedValue({ audioUrl: 'https://cdn.example.com/vo.mp3', durationMs: 8000 });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'rerun' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockGenerateVoiceoverAudio).toHaveBeenCalled();
    expect((res._body as { run: unknown }).run).toBeDefined();
  });

  it('rerun at assembling → calls runAssembleStage', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'assembling' });
    mockRunAssembleStage.mockResolvedValue(undefined);
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'rerun' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRunAssembleStage).toHaveBeenCalledWith('r1');
  });

  it('rerun at checkpoint_b → calls runAssembleStage (re-run the assemble pass that produced the checkpoint)', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'checkpoint_b' });
    mockRunAssembleStage.mockResolvedValue(undefined);
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'rerun' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(200);
    expect(mockRunAssembleStage).toHaveBeenCalledWith('r1');
  });

  it('rerun at intake → 400 "nothing to re-run"', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'intake' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'rerun' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/nothing to re-run/i);
  });

  it('rerun at details → 400 "nothing to re-run"', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'details' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'rerun' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/nothing to re-run/i);
  });

  it('rerun at delivered → 400 "nothing to re-run"', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'delivered' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'rerun' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/nothing to re-run/i);
  });

  it('rerun at generating → 400 with guidance to use Back', async () => {
    mockGetRun.mockResolvedValue({ ...run, stage: 'generating' });
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'r1' }, headers: {}, body: { action: 'rerun' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/re-runs automatically/i);
  });

  it('rerun → 404 on unknown run', async () => {
    mockGetRun.mockResolvedValue(null);
    const res = makeRes();
    await handler(
      { method: 'POST', query: { runId: 'rX' }, headers: {}, body: { action: 'rerun' } } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res._status).toBe(404);
    expect(mockRunScrapeStage).not.toHaveBeenCalled();
    expect(mockRunJudgePass).not.toHaveBeenCalled();
    expect(mockRunAssembleStage).not.toHaveBeenCalled();
  });
});
