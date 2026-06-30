import { describe, expect, it } from 'vitest';
import { DisallowedUrlError, assertAllowedMediaUrl } from '../url-guard.js';

describe('assertAllowedMediaUrl', () => {
  // ── allowed ────────────────────────────────────────────────────────────────

  describe('allowed URLs', () => {
    it('accepts a Backblaze B2 URL (prod render output)', () => {
      const url = assertAllowedMediaUrl('https://f002.backblazeb2.com/file/x/v.mp4');
      expect(url.hostname).toBe('f002.backblazeb2.com');
    });

    it('accepts a Bunny b-cdn.net subdomain URL', () => {
      const url = assertAllowedMediaUrl('https://vz-01cb8232-b48.b-cdn.net/x.mp4');
      expect(url.hostname).toBe('vz-01cb8232-b48.b-cdn.net');
    });

    it('accepts deep subdomains of b-cdn.net', () => {
      expect(() =>
        assertAllowedMediaUrl('https://library-123.b-cdn.net/path/to/file.mp4'),
      ).not.toThrow();
    });

    it('accepts iframe.mediadelivery.net', () => {
      expect(() =>
        assertAllowedMediaUrl('https://iframe.mediadelivery.net/embed/123/abc'),
      ).not.toThrow();
    });

    it('accepts video.bunnycdn.com', () => {
      expect(() =>
        assertAllowedMediaUrl('https://video.bunnycdn.com/play/123/abc.mp4'),
      ).not.toThrow();
    });

    it('accepts a Supabase Storage subdomain URL', () => {
      expect(() =>
        assertAllowedMediaUrl(
          'https://abc.supabase.co/storage/v1/object/public/x.mp4',
        ),
      ).not.toThrow();
    });

    it('accepts an arbitrary public CDN hostname', () => {
      expect(() =>
        assertAllowedMediaUrl('https://cdn.example.com/x.mp4'),
      ).not.toThrow();
    });
  });

  // ── rejected — scheme ──────────────────────────────────────────────────────

  describe('rejected — wrong scheme', () => {
    it('rejects http:// URLs', () => {
      expect(() => assertAllowedMediaUrl('http://x.b-cdn.net/v.mp4')).toThrow(
        DisallowedUrlError,
      );
    });

    it('rejects ftp:// URLs', () => {
      expect(() => assertAllowedMediaUrl('ftp://myzone.b-cdn.net/file.mp4')).toThrow(
        DisallowedUrlError,
      );
    });
  });

  // ── rejected — IP literals ─────────────────────────────────────────────────

  describe('rejected — IP-literal hosts', () => {
    it('rejects IPv4 link-local (IMDS / cloud metadata address)', () => {
      expect(() =>
        assertAllowedMediaUrl('https://169.254.169.254/latest/meta-data/'),
      ).toThrow(DisallowedUrlError);
    });

    it('rejects IPv4 loopback', () => {
      expect(() => assertAllowedMediaUrl('https://127.0.0.1/x')).toThrow(
        DisallowedUrlError,
      );
    });

    it('rejects IPv4 private range', () => {
      expect(() => assertAllowedMediaUrl('https://10.0.0.1/x')).toThrow(
        DisallowedUrlError,
      );
    });

    it('rejects IPv6 loopback', () => {
      expect(() => assertAllowedMediaUrl('https://[::1]/x')).toThrow(
        DisallowedUrlError,
      );
    });

    it('rejects full IPv6 address', () => {
      expect(() =>
        assertAllowedMediaUrl('https://[2001:db8::1]/file.mp4'),
      ).toThrow(DisallowedUrlError);
    });
  });

  // ── rejected — internal hostnames ─────────────────────────────────────────

  describe('rejected — internal/loopback hostnames', () => {
    it('rejects localhost', () => {
      expect(() => assertAllowedMediaUrl('https://localhost/x')).toThrow(
        DisallowedUrlError,
      );
    });

    it('rejects a .local mDNS hostname', () => {
      expect(() => assertAllowedMediaUrl('https://foo.local/x')).toThrow(
        DisallowedUrlError,
      );
    });

    it('rejects metadata.google.internal (GCE metadata service)', () => {
      expect(() =>
        assertAllowedMediaUrl('https://metadata.google.internal/x'),
      ).toThrow(DisallowedUrlError);
    });

    it('rejects any .internal hostname', () => {
      expect(() => assertAllowedMediaUrl('https://service.internal/x')).toThrow(
        DisallowedUrlError,
      );
    });

    it('rejects any .lan hostname', () => {
      expect(() => assertAllowedMediaUrl('https://nas.lan/x')).toThrow(
        DisallowedUrlError,
      );
    });

    it('rejects bare "metadata" hostname', () => {
      expect(() => assertAllowedMediaUrl('https://metadata/x')).toThrow(
        DisallowedUrlError,
      );
    });
  });

  // ── rejected — malformed ───────────────────────────────────────────────────

  describe('rejected — malformed input', () => {
    it('rejects a non-URL string', () => {
      expect(() => assertAllowedMediaUrl('not-a-url')).toThrow(DisallowedUrlError);
    });

    it('rejects an empty string', () => {
      expect(() => assertAllowedMediaUrl('')).toThrow(DisallowedUrlError);
    });

    it('rejects a plain filename', () => {
      expect(() => assertAllowedMediaUrl('video.mp4')).toThrow(DisallowedUrlError);
    });
  });
});
