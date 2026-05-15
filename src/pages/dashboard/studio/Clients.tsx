import type { CSSProperties } from 'react';
import { StudioNav } from '@/components/studio/StudioNav';
import '@/v2/styles/v2.css';

const EYEBROW: CSSProperties = {
  fontFamily: 'var(--le-font-mono)',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.45)',
};

const Clients = () => {
  return (
    <div className="space-y-8">
      <div>
        <span style={EYEBROW}>— Clients</span>
        <h2
          className="mt-3"
          style={{
            fontFamily: 'var(--le-font-sans)',
            fontSize: 'clamp(28px, 4vw, 44px)',
            fontWeight: 500,
            letterSpacing: '-0.035em',
            lineHeight: 0.98,
            color: '#fff',
            margin: 0,
          }}
        >
          Clients
        </h2>
      </div>
      <StudioNav />
      <p className="text-sm text-muted-foreground">Client list — coming soon.</p>
    </div>
  );
};

export default Clients;
