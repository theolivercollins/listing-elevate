import { describe, it, expect } from 'vitest';
import { normalizePhone, formatPhoneDisplay, formatAsYouType } from '../phone';

describe('normalizePhone', () => {
  it('strips everything but digits', () => {
    expect(normalizePhone('(941) 205-9011')).toBe('9412059011');
  });
  it('drops a leading US country code 1 on 11-digit numbers', () => {
    expect(normalizePhone('+1 941 205 9011')).toBe('9412059011');
  });
  it('passes through short fragments', () => {
    expect(normalizePhone('941')).toBe('941');
  });
});

describe('formatPhoneDisplay', () => {
  it('renders 10 digits as (941) 205-9011', () => {
    expect(formatPhoneDisplay('9412059011')).toBe('(941) 205-9011');
  });
  it('formats already-decorated input', () => {
    expect(formatPhoneDisplay('941.205.9011')).toBe('(941) 205-9011');
  });
  it('returns non-10-digit input unchanged', () => {
    expect(formatPhoneDisplay('12345')).toBe('12345');
  });
  it('returns null for null/empty', () => {
    expect(formatPhoneDisplay(null)).toBeNull();
    expect(formatPhoneDisplay('')).toBeNull();
  });
});

describe('formatAsYouType', () => {
  it('opens paren from the first digit', () => {
    expect(formatAsYouType('9')).toBe('(9');
  });
  it('closes area code at 4+ digits', () => {
    expect(formatAsYouType('9412')).toBe('(941) 2');
  });
  it('adds the dash at 7+ digits', () => {
    expect(formatAsYouType('9412059')).toBe('(941) 205-9');
  });
  it('caps at 10 digits', () => {
    expect(formatAsYouType('94120590113333')).toBe('(941) 205-9011');
  });
  it('empty input stays empty', () => {
    expect(formatAsYouType('')).toBe('');
  });
});
