/**
 * AutopilotBadge — small status pill shown in the PropertyCommandCenter header
 * whenever a delivery_run has auto_run=true.
 *
 * Two states:
 *   live   → green pill "Autopilot — AI is running this listing"
 *   paused → amber pill "Autopilot paused — needs you"
 */

interface AutopilotBadgeProps {
  /** True when autopilot is paused (paused_reason is non-null on the run). */
  paused: boolean;
}

export function AutopilotBadge({ paused }: AutopilotBadgeProps) {
  if (paused) {
    return (
      <span
        data-testid="autopilot-badge-paused"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 10px',
          borderRadius: 'var(--le-r-pill)',
          background: 'rgba(182,128,44,0.10)',
          color: 'var(--le-warn)',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '-0.01em',
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--le-warn)',
            flexShrink: 0,
          }}
        />
        Autopilot paused — needs you
      </span>
    );
  }

  return (
    <span
      data-testid="autopilot-badge-live"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 'var(--le-r-pill)',
        background: 'rgba(47,138,85,0.10)',
        color: 'var(--le-good)',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '-0.01em',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'var(--le-good)',
          flexShrink: 0,
        }}
      />
      Autopilot — AI is running this listing
    </span>
  );
}
