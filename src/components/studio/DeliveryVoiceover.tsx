/**
 * DeliveryVoiceover — Voiceover step UI for the operator delivery pipeline.
 *
 * Layout:
 *  1. "Generate script" button → editable textarea bound to local state.
 *     On blur/Save: POSTs set_script (server logs script_edit with before/after).
 *  2. Voice picker: radio cards from GET /api/admin/studio/voices?client_id=X.
 *     Client voice is prepended with a "Client voice" badge when present.
 *     Selecting POSTs set_voice (is_client_voice flag included).
 *  3. "Generate audio" POSTs generate_audio; on success renders <audio controls>.
 *
 * The shared DeliveryNextButton (in PropertyCommandCenter) advances voiceover → music.
 * Skip is allowed — assembly proceeds without VO if the operator never generates audio.
 */

import { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { authedFetch } from '@/lib/api';
import type { Voice } from '../../../../lib/voiceover/voices';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeliveryVoiceoverProps {
  runId: string;
  clientId: string | null;
  /** Pre-loaded from bundle.delivery_run */
  voiceoverScript: string | null;
  voiceoverVoiceId: string | null;
  voiceoverAudioUrl: string | null;
  onChanged: () => void;
}

interface VoicesResponse {
  voices: Voice[];
  client_voice_id: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DeliveryVoiceover({
  runId,
  clientId,
  voiceoverScript,
  voiceoverVoiceId,
  voiceoverAudioUrl,
  onChanged,
}: DeliveryVoiceoverProps) {
  // Script state
  const [script, setScript] = useState(voiceoverScript ?? '');
  const [generatingScript, setGeneratingScript] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [savingScript, setSavingScript] = useState(false);
  const [scriptSaved, setScriptSaved] = useState(false);
  const savedScriptRef = useRef(voiceoverScript ?? '');

  // Voice picker state
  const [voices, setVoices] = useState<Voice[]>([]);
  const [clientVoiceId, setClientVoiceId] = useState<string | null>(null);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(voiceoverVoiceId);
  const [settingVoice, setSettingVoice] = useState(false);

  // Audio generation state
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(voiceoverAudioUrl);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [durationWarning, setDurationWarning] = useState<string | null>(null);

  // Load voice roster
  useEffect(() => {
    let cancelled = false;
    setVoicesLoading(true);
    const url = clientId
      ? `/api/admin/studio/voices?client_id=${encodeURIComponent(clientId)}`
      : '/api/admin/studio/voices';
    authedFetch(url)
      .then((r) => r.json())
      .then((d: VoicesResponse) => {
        if (cancelled) return;
        setVoices(d.voices ?? []);
        setClientVoiceId(d.client_voice_id ?? null);
      })
      .catch(() => {
        if (!cancelled) setVoices([]);
      })
      .finally(() => { if (!cancelled) setVoicesLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  // Keep local script in sync when parent re-syncs bundle
  useEffect(() => {
    setScript(voiceoverScript ?? '');
    savedScriptRef.current = voiceoverScript ?? '';
  }, [voiceoverScript]);

  useEffect(() => { setAudioUrl(voiceoverAudioUrl); }, [voiceoverAudioUrl]);
  useEffect(() => { setSelectedVoiceId(voiceoverVoiceId); }, [voiceoverVoiceId]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleGenerateScript = async () => {
    setGeneratingScript(true);
    setScriptError(null);
    try {
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_script' }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const d = await res.json() as { run: { voiceover_script?: string } };
      const newScript = d.run?.voiceover_script ?? '';
      setScript(newScript);
      savedScriptRef.current = newScript;
      setScriptSaved(false);
      onChanged();
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : 'Script generation failed');
    } finally {
      setGeneratingScript(false);
    }
  };

  const handleSaveScript = async () => {
    if (!script.trim() || script === savedScriptRef.current) return;
    setSavingScript(true);
    setScriptSaved(false);
    try {
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_script', script: script.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      savedScriptRef.current = script.trim();
      setScriptSaved(true);
      onChanged();
    } catch (err) {
      setScriptError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingScript(false);
    }
  };

  const handleSelectVoice = async (voiceId: string) => {
    if (voiceId === selectedVoiceId) return;
    setSettingVoice(true);
    try {
      const isClientVoice = voiceId === clientVoiceId;
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_voice', voice_id: voiceId, is_client_voice: isClientVoice }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setSelectedVoiceId(voiceId);
      onChanged();
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Voice selection failed');
    } finally {
      setSettingVoice(false);
    }
  };

  const handleGenerateAudio = async () => {
    setGeneratingAudio(true);
    setAudioError(null);
    try {
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_audio' }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const d = await res.json() as {
        run: { voiceover_audio_url?: string; voiceover_script?: string };
        duration_warning?: string;
      };
      setAudioUrl(d.run?.voiceover_audio_url ?? null);
      setDurationWarning(d.duration_warning ?? null);
      // The server may auto-shorten the script to fit the duration — sync it
      // so the textarea shows what's actually spoken.
      if (d.run?.voiceover_script) {
        setScript(d.run.voiceover_script);
        savedScriptRef.current = d.run.voiceover_script;
      }
      onChanged();
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Audio generation failed');
    } finally {
      setGeneratingAudio(false);
    }
  };

  // ─── Build ordered voice list (client voice prepended if present) ────────────

  // The API prepends a synthesized entry for custom client voices; if an older
  // API response omits it, synthesize a fallback rather than dropping the voice.
  const clientVoiceEntry: Voice | null = clientVoiceId
    ? voices.find((v) => v.id === clientVoiceId) ?? {
        id: clientVoiceId,
        name: 'Client voice',
        gender: 'custom',
        description: "Client's custom ElevenLabs voice",
      }
    : null;
  const nonClientVoices = voices.filter((v) => v.id !== clientVoiceId);
  const orderedVoices = clientVoiceEntry
    ? [clientVoiceEntry, ...nonClientVoices]
    : nonClientVoices;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="studio-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Eyebrow */}
      <span
        style={{
          display: 'block',
          fontSize: 11.5,
          fontWeight: 500,
          color: 'var(--le-muted)',
          marginBottom: -16,
        }}
      >
        Operator · Step
      </span>

      {/* Title */}
      <h3
        style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          color: 'var(--le-ink)',
        }}
      >
        Voiceover
      </h3>

      {/* ── Script section ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--le-ink)' }}>
            Script
          </span>
          <button
            type="button"
            className="studio-cta-primary"
            style={{ fontSize: 12, padding: '6px 14px' }}
            disabled={generatingScript}
            onClick={handleGenerateScript}
          >
            {generatingScript && <Loader2 size={12} className="studio-spinner" />}
            {script ? 'Regenerate script' : 'Generate script'}
          </button>
        </div>

        <textarea
          className="studio-textarea"
          rows={6}
          value={script}
          onChange={(e) => { setScript(e.target.value); setScriptSaved(false); }}
          onBlur={handleSaveScript}
          placeholder="Click 'Generate script' to create a voiceover script from listing details…"
          disabled={generatingScript}
        />

        {/* Save row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="studio-btn-ghost"
            style={{ fontSize: 12, padding: '5px 12px' }}
            disabled={savingScript || !script.trim() || script === savedScriptRef.current}
            onClick={handleSaveScript}
          >
            {savingScript && <Loader2 size={11} className="studio-spinner" />}
            Save script
          </button>
          {scriptSaved && (
            <span style={{ fontSize: 12, color: 'var(--le-good, #166534)', fontWeight: 500 }}>Saved</span>
          )}
          {scriptError && (
            <span className="studio-error-strip" style={{ padding: '4px 10px', fontSize: 12 }}>
              {scriptError}
            </span>
          )}
        </div>
      </div>

      {/* ── Voice picker ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--le-ink)' }}>
          Voice
        </span>

        {voicesLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--le-muted)', fontSize: 13 }}>
            <Loader2 size={14} className="studio-spinner" /> Loading voices…
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 10,
            }}
          >
            {orderedVoices.map((voice) => {
              const isClient = voice.id === clientVoiceId;
              const isSelected = voice.id === selectedVoiceId;
              return (
                <button
                  key={voice.id}
                  type="button"
                  onClick={() => !settingVoice && handleSelectVoice(voice.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 6,
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: `1.5px solid ${isSelected ? 'var(--le-ink)' : 'var(--le-line)'}`,
                    background: isSelected ? 'rgba(11,11,16,0.04)' : 'var(--le-surface)',
                    cursor: settingVoice ? 'wait' : 'pointer',
                    textAlign: 'left',
                    transition: 'border-color 120ms, background 120ms',
                  }}
                  aria-pressed={isSelected}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--le-ink)', flex: 1 }}>
                      {voice.name}
                    </span>
                    {isClient && (
                      <span
                        className="studio-status-pill"
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          background: 'rgba(42,111,219,0.08)',
                          color: 'var(--le-accent)',
                          borderRadius: 4,
                        }}
                      >
                        Client voice
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--le-muted)', textTransform: 'capitalize' }}>
                    {voice.gender}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--le-muted-2, var(--le-muted))', lineHeight: 1.4 }}>
                    {voice.description}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Audio generation ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--le-ink)' }}>
          Audio
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="studio-cta-primary"
            style={{ fontSize: 12, padding: '6px 14px' }}
            disabled={generatingAudio || !script.trim() || !selectedVoiceId}
            onClick={handleGenerateAudio}
            title={
              !script.trim() ? 'Generate a script first' :
              !selectedVoiceId ? 'Pick a voice first' :
              'Generate voiceover audio'
            }
          >
            {generatingAudio && <Loader2 size={12} className="studio-spinner" />}
            {audioUrl ? 'Regenerate audio' : 'Generate audio'}
          </button>
          {(!script.trim() || !selectedVoiceId) && (
            <span style={{ fontSize: 12, color: 'var(--le-muted)', fontStyle: 'italic' }}>
              {!script.trim() ? 'Script required first' : 'Pick a voice first'}
            </span>
          )}
        </div>

        {audioError && (
          <span className="studio-error-strip" style={{ padding: '4px 10px', fontSize: 12 }}>
            {audioError} — you can skip this step and assembly will proceed without voiceover.
          </span>
        )}

        {audioUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11.5, color: 'var(--le-muted)', fontWeight: 500 }}>Preview</span>
            <audio
              controls
              src={audioUrl}
              style={{ width: '100%', maxWidth: 480 }}
            />
            {durationWarning && (
              <span style={{ fontSize: 12, color: 'var(--le-muted)' }}>
                Runs long even after auto-shortening: {durationWarning}. Trim the script and regenerate if needed.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
