import { describe, it, expect } from 'vitest';
import { errMsg } from '../err-msg';

describe('errMsg', () => {
  it('returns .message for an Error instance', () => {
    expect(errMsg(new Error('boom'))).toBe('boom');
  });

  it('returns a subclassed Error message unchanged', () => {
    class CustomError extends Error {}
    expect(errMsg(new CustomError('custom boom'))).toBe('custom boom');
  });

  it('returns a plain string as-is', () => {
    expect(errMsg('already a string')).toBe('already a string');
  });

  it('never returns the literal "[object Object]" for a Supabase-shaped thrown object', () => {
    // Real shape of a thrown/returned PostgrestError — a plain object, NOT an
    // Error instance. This is the exact live-incident trigger (2026-07-02):
    // `String(err)` on this object produces "[object Object]".
    const supabaseError = {
      code: '23505',
      details: 'Key (address)=(123 Main St) already exists.',
      hint: null,
      message: 'duplicate key value violates unique constraint "properties_address_key"',
    };
    const result = errMsg(supabaseError);
    expect(result).not.toContain('[object Object]');
    // The real .message text must survive somewhere in the output.
    expect(result).toContain('duplicate key value violates unique constraint');
    expect(result).toContain('23505');
  });

  it('falls back to String(err) when JSON.stringify throws on a circular object', () => {
    const circular: Record<string, unknown> = { message: 'has a cycle' };
    circular.self = circular;
    expect(() => errMsg(circular)).not.toThrow();
    const result = errMsg(circular);
    expect(typeof result).toBe('string');
    expect(result).not.toBe('');
  });

  it('renders a plain number via JSON.stringify (unchanged from String())', () => {
    expect(errMsg(42)).toBe('42');
  });

  it('renders null via JSON.stringify', () => {
    expect(errMsg(null)).toBe('null');
  });

  it('falls back to String() for undefined (JSON.stringify(undefined) is itself undefined)', () => {
    expect(errMsg(undefined)).toBe('undefined');
  });

  it('renders a plain array via JSON.stringify', () => {
    expect(errMsg([1, 2, 3])).toBe('[1,2,3]');
  });
});
