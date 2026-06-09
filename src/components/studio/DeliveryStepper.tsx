import { DELIVERY_STAGES, type DeliveryStage, stageIndex } from '../../../lib/delivery/state';

const STAGE_LABELS: Record<DeliveryStage, string> = {
  intake: 'Intake', scraping: 'Scrape', generating: 'Generate', judging: 'Judge',
  checkpoint_a: 'Checkpoint A', details: 'Details', voiceover: 'Voiceover',
  music: 'Music', assembling: 'Assemble', checkpoint_b: 'Checkpoint B', delivered: 'Delivered',
};

export function DeliveryStepper({ stage, error }: { stage: DeliveryStage; error: string | null }) {
  const current = stageIndex(stage);
  return (
    <div className="studio-card" style={{ padding: '16px 20px', overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: 720 }}>
        {DELIVERY_STAGES.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < DELIVERY_STAGES.length - 1 ? 1 : 'none' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 600,
                  background: done ? 'var(--le-ink)' : active ? 'var(--le-surface)' : 'transparent',
                  color: done ? 'var(--le-surface)' : active ? 'var(--le-ink)' : 'var(--le-muted-2)',
                  border: `1.5px solid ${done || active ? 'var(--le-ink)' : 'var(--le-line)'}`,
                }}>{i + 1}</span>
                <span style={{ fontSize: 10.5, fontWeight: active ? 600 : 500, whiteSpace: 'nowrap', color: active ? 'var(--le-ink)' : 'var(--le-muted)' }}>
                  {STAGE_LABELS[s]}
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
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--le-bad, #b42318)' }}>
          Stage error: {error} — fix below and retry.
        </p>
      )}
    </div>
  );
}
