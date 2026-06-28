import { describe, expect, it } from 'vitest';
import { DisallowedUrlError, assertAllowedMediaUrl } from '../url-guard.js';

describe('assertAllowedMediaUrl', () => {
  // ── allowed ────────────────────────────────────────────────────────────────

  describe('allowed URLs', () => {
    it('accepts a Bunny b-cdn.net subdomain URL', () => {
      const url = assertAllowedMediaUrl('https://myzone.b-cdn.net/videos/abc.mp4');
      expect(url.hostname).toBe('myzone.b-cdn.net');
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
          'https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/videos/a.mp4',
        ),
      ).not.toThrow();
    });
  });

  // ── rejected — scheme ──────────────────────────────────────────────────────

  describe('rejected — wrong scheme', () => {
    it('rejects http:// URLs', () => {
      expect(() => assertAllowedMediaUrl('http://myzone.b-cdn.net/file.mp4')).toThrow(
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
    it('rejects IPv4 link-local (IMDS address)', () => {
      expect(() =>
        assertAllowedMediaUrl('https://169.254.169.254/latest/meta-data/'),
      ).toThrow(DisallowedUrlError);
    });

    it('rejects IPv4 loopback', () => {
      expect(() => assertAllowedMediaUrl('https://127.0.0.1/file.mp4')).toThrow(
        DisallowedUrlError,
      );
    });

    it('rejects IPv4 private range', () => {
      expect(() => assertAllowedMediaUrl('https://10.0.0.1/file.mp4')).toThrow(
        DisallowedUrlError,
      );
    });

    it('rejects IPv6 loopback', () => {
      expect(() => assertAllowedMediaUrl('https://[::1]/file.mp4')).toThrow(
        DisallowedUrlError,
      );
    });

    it('rejects full IPv6 address', () => {
      expect(() =>
        assertAllowedMediaUrl('https://[2001:db8::1]/file.mp4'),
      ).toThrow(DisallowedUrlError);
    });
  });

  // ── rejected — not-allowlisted hosts ──────────────────────────────────────

  describe('rejected — hostname not on allowlist', () => {
    it('rejects an arbitrary external host', () => {
      expect(() => assertAllowedMediaUrl('https://evil.com/steal.mp4')).toThrow(
        DisallowedUrlError,
      );
    });

    it('rejects localhost', () => {
      expect(() => assertAllowedMediaUrl('https://localhost/file.mp4')).toThrow(
        DisallowedUrlError,
      );
    });

    it('rejects a lookalike domain (b-cdn.net.evil.com)', () => {
      expect(() =>
        assertAllowedMediaUrl('https://b-cdn.net.evil.com/file.mp4'),
      ).toThrow(DisallowedUrlError);
    });

    it('rejects bare b-cdn.net without subdomain', () => {
      // The allowlist requires at least one label before .b-cdn.net
      expect(() => assertAllowedMediaUrl('https://b-cdn.net/file.mp4')).toThrow(
        DisallowedUrlError,
      );
    });

    it('rejects bare supabase.co without subdomain', () => {
      expect(() => assertAllowedMediaUrl('https://supabase.co/file.mp4')).toThrow(
        DisallowedUrlError,
      );
    });
  });

  // ── rejected — malformed ───────────────────────────────────────────────────

  describe('rejected — malformed input', () => {
    it('rejects an empty string', () => {
      expect(() => assertAllowedMediaUrl('')).toThrow(DisallowedUrlError);
    });

    it('rejects a plain filename', () => {
      expect(() => assertAllowedMediaUrl('video.mp4')).toThrow(DisallowedUrlError);
    });
  });
});
