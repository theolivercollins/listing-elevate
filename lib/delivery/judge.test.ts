import { describe, it, expect } from 'vitest';
import { scoreTotal, pickWinner, parseJudgeJson } from './judge';

const s = (motion: number, artifacts: number, realism: number, composition: number) =>
  ({ motion_quality: motion, artifacts, realism, composition });

describe('scoreTotal', () => {
  it('sums the four rubric dimensions', () => {
    expect(scoreTotal(s(4, 3, 5, 4))).toBe(16);
  });
});

describe('pickWinner', () => {
  it('higher total wins', () => {
    expect(pickWinner(s(4, 4, 4, 4), s(5, 5, 5, 5))).toBe('B');
    expect(pickWinner(s(5, 5, 5, 4), s(4, 4, 4, 4))).toBe('A');
  });
  it('tie goes to A (deterministic)', () => {
    expect(pickWinner(s(4, 4, 4, 4), s(4, 4, 4, 4))).toBe('A');
  });
  it('missing B scores -> A (degraded pair)', () => {
    expect(pickWinner(s(1, 1, 1, 1), null)).toBe('A');
  });
  it('missing A scores -> B', () => {
    expect(pickWinner(null, s(1, 1, 1, 1))).toBe('B');
  });
});

describe('parseJudgeJson', () => {
  it('parses fenced JSON and clamps to the rubric shape', () => {
    const parsed = parseJudgeJson('```json\n{"a":{"motion_quality":4,"artifacts":3,"realism":5,"composition":4},"b":{"motion_quality":2,"artifacts":2,"realism":2,"composition":2}}\n```');
    expect(parsed.a?.motion_quality).toBe(4);
    expect(parsed.b?.composition).toBe(2);
  });
  it('throws on non-JSON', () => {
    expect(() => parseJudgeJson('the better clip is A')).toThrow(/non-JSON/);
  });
});
