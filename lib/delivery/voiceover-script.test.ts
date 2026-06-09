import { describe, it, expect } from 'vitest';
import { buildScriptUserMessage } from './voiceover-script';

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
