import { describe, it, expect } from 'vitest';
import { buildScriptUserMessage, buildShortenUserMessage } from './voiceover-script';

describe('buildScriptUserMessage', () => {
  it('includes address, video type label, duration, details, and MLS description', () => {
    const msg = buildScriptUserMessage({
      address: '470 Sorrento Ct, Punta Gorda, FL',
      videoType: 'just_pended',
      durationSec: 30,
      details: { price: 899000, beds: 3, baths: 2, sqft: 1823, mls_description: 'Waterfront pool home.' },
    });
    expect(msg).toContain('470 Sorrento Ct');
    expect(msg).toContain('Just Pended');
    expect(msg).toContain('30 seconds');
    expect(msg).toContain('$899,000');
    expect(msg).toContain('3 bed');
    expect(msg).toContain('Waterfront pool home.');
  });

  it('omits missing details gracefully', () => {
    const msg = buildScriptUserMessage({ address: 'X St', videoType: 'just_listed', durationSec: 15, details: {} });
    expect(msg).not.toContain('$');
    expect(msg).toContain('Just Listed');
  });
});

describe('buildShortenUserMessage', () => {
  it('states actual vs target duration and the shortening rules', () => {
    const msg = buildShortenUserMessage({
      script: '[warmly] Just listed at $599,900 — your Florida dream home.',
      actualSeconds: 17.25,
      targetSeconds: 15,
    });
    expect(msg).toContain('runs 17.3s but must fit in 15s');
    expect(msg).toContain('Shorten it naturally');
    expect(msg).toContain('keep complete sentences');
    expect(msg).toContain('keep the address and price if present');
    expect(msg).toContain('Output the script only.');
    expect(msg).toContain('Just listed at $599,900');
  });

  it('formats whole-number actual seconds with one decimal', () => {
    const msg = buildShortenUserMessage({ script: 'Hi.', actualSeconds: 32, targetSeconds: 30 });
    expect(msg).toContain('runs 32.0s but must fit in 30s');
  });
});
