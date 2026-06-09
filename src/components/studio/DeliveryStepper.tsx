import { Loader2 } from 'lucide-react';
import { DELIVERY_STAGES, type DeliveryStage, stageIndex, nextStage } from '../../../lib/delivery/state';

const STAGE_LABELS: Record<DeliveryStage, string> = {
  intake: 'Intake', scraping: 'Scrape', generating: 'Generate', judging: 'Judge',
  checkpoint_a: 'Checkpoint A', details: 'Details', voiceover: 'Voiceover',
  music: 'Music', assembling: 'Assemble', checkpoint_b: 'Checkpoint B', delivered: 'Delivered',
};

// Gate stages where the operator manually advances the run.
const GATE_STAGES = [
  'checkpoint_a', 'details', 'voiceover', 'music', 'checkpoint_b',
] as const satisfies readonly DeliveryStage[];

function isGateStage(s: DeliveryStage): s is (typeof GATE_STAGES)[number] {
  return (GATE_STAGES as readonly string[]).includes(s);
}

// ─── DeliveryStepper ──────────────────────────────────────────────────────────

export function DeliveryStepper({ stage, error }: { stage: DeliveryStage; error: string | null }) {
  const current = stageIndex(stage);
  return (
    <div className="studio-card" style={{ padding: '16px 20px', overflowX: 'auto' }}>
      <div
        role="list"
        aria-label="Delivery stages"
        style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: 720 }}
      >
        {DELIVERY_STAGES.map((s, i) => {
          const done = i < current;
          const active = i === current;
          const label = STAGE_LABELS[s];
          const ariaLabel = active
            ? `${label} — current`
            : done
            ? `${label} — done`
            : `${label} — upcoming`;
          return (
            <div
              key={s}
              role="listitem"
              aria-label={ariaLabel}
              {...(active ? { 'aria-current': 'step' as const } : {})}
              style={{ display: 'flex', alignItems: 'center', flex: i < DELIVERY_STAGES.length - 1 ? 1 : 'none' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 600,
                  background: done ? 'var(--le-ink)' : active ? 'var(--le-surface)' : 'transparent',
                  color: done ? 'var(--le-surface)' : active ? 'var(--le-ink)' : 'var(--le-muted-2)',
                  border: `1.5px solid ${done || active ? 'var(--le-ink)' : 'var(--le-line)'}`,
                }}>{i + 1}</span>
                <span style={{ fontSize: 10.5, fontWeight: active ? 600 : 500, whiteSpace: 'nowrap', color: active ? 'var(--le-ink)' : 'var(--le-muted)' }}>
                  {label}
                </span>
              </div>
              {i < DELIVERY_STAGES.length - 1 && (
                <div style={{ flex: 1, height: 1.5, margin: '0 6px 16px', background: done ? 'var(--le-ink)' : 'var(--le-line)' }} />
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--le-bad)' }}>
          Stage error: {error} — fix below and retry.
        </p>
      )}
    </div>
  );
}

// ─── DeliveryNextButton ───────────────────────────────────────────────────────

export interface DeliveryNextButtonProps {
  stage: DeliveryStage;
  pending: boolean;
  error: string | null;
  onAdvance: (to: DeliveryStage) => void;
}

export function DeliveryNextButton({ stage, pending, error, onAdvance }: DeliveryNextButtonProps) {
  if (!isGateStage(stage)) return null;
  const next = nextStage(stage);
  if (!next) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <button
        type="button"
        className="studio-cta-primary"
        style={{ fontSize: 12.5, padding: '8px 16px' }}
        disabled={pending}
        onClick={() => onAdvance(next)}
      >
        {pending && <Loader2 size={12} className="studio-spinner" />}
        Advance to {next.replace(/_/g, ' ')}
      </button>
      {error && (
        <span className="studio-error-strip" style={{ padding: '4px 10px', fontSize: 12 }}>
          {error}
        </span>
      )}
    </div>
  );
}
