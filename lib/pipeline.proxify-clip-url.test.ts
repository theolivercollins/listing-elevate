/**
 * Unit tests for proxifyClipUrl (lib/pipeline.ts).
 *
 * Bunny CDN clips need a Referer header that Creatomate's render server does not
 * supply. proxifyClipUrl rewrites Bunny CDN URLs to route through
 * /api/clip-proxy, which injects the header. Non-Bunny URLs are untouched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { proxifyClipUrl } from './pipeline.js';

const BUNNY_HOST = 'vz-abc123-test.b-cdn.net';
const BASE_URL = 'https://listingelevate.com';

let origCdnHostname: string | undefined;
let origBaseUrl: string | undefined;

beforeEach(() => {
  origCdnHostname = process.env.BUNNY_STREAM_CDN_HOSTNAME;
  origBaseUrl = process.env.LE_PUBLIC_BASE_URL;
  process.env.BUNNY_STREAM_CDN_HOSTNAME = BUNNY_HOST;
  process.env.LE_PUBLIC_BASE_URL = BASE_URL;
});

afterEach(() => {
  if (origCdnHostname === undefined) delete process.env.BUNNY_STREAM_CDN_HOSTNAME;
  else process.env.BUNNY_STREAM_CDN_HOSTNAME = origCdnHostname;
  if (origBaseUrl === undefined) delete process.env.LE_PUBLIC_BASE_URL;
  else process.env.LE_PUBLIC_BASE_URL = origBaseUrl;
});

describe('proxifyClipUrl', () => {
  it('wraps a Bunny CDN URL in /api/clip-proxy with correct base and encoded url param', () => {
    const bunnyUrl = `https://${BUNNY_HOST}/some-guid/play_1080p.mp4`;
    const result = proxifyClipUrl(bunnyUrl);
    expect(result).toBe(
      `${BASE_URL}/api/clip-proxy?url=${encodeURIComponent(bunnyUrl)}`,
    );
  });

  it('passes a non-Bunny URL through unchanged', () => {
    const other = 'https://cdn.example.com/scene-video.mp4';
    expect(proxifyClipUrl(other)).toBe(other);
  });

  it('passes a Creatomate render CDN URL through unchanged', () => {
    const creatomate = 'https://cdn.creatomate.com/renders/abc.mp4';
    expect(proxifyClipUrl(creatomate)).toBe(creatomate);
  });

  it('returns the URL unchanged when BUNNY_STREAM_CDN_HOSTNAME is not set (safe passthrough)', () => {
    delete process.env.BUNNY_STREAM_CDN_HOSTNAME;
    const bunnyUrl = `https://${BUNNY_HOST}/some-guid/play_1080p.mp4`;
    expect(proxifyClipUrl(bunnyUrl)).toBe(bunnyUrl);
  });

  it('uses LE_PUBLIC_BASE_URL from env when building the proxy URL', () => {
    process.env.LE_PUBLIC_BASE_URL = 'https://staging.listingelevate.com';
    const bunnyUrl = `https://${BUNNY_HOST}/guid/play_1080p.mp4`;
    const result = proxifyClipUrl(bunnyUrl);
    expect(result).toMatch(/^https:\/\/staging\.listingelevate\.com\/api\/clip-proxy/);
  });

  it('falls back to https://listingelevate.com when LE_PUBLIC_BASE_URL is not set', () => {
    delete process.env.LE_PUBLIC_BASE_URL;
    const bunnyUrl = `https://${BUNNY_HOST}/guid/play_1080p.mp4`;
    const result = proxifyClipUrl(bunnyUrl);
    expect(result).toMatch(/^https:\/\/listingelevate\.com\/api\/clip-proxy/);
  });

  it('returns a malformed URL unchanged rather than throwing', () => {
    const bad = 'not-a-url-at-all';
    expect(proxifyClipUrl(bad)).toBe(bad);
  });
});
