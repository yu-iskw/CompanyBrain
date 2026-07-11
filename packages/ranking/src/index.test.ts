import { describe, expect, it } from 'vitest';

import { recencyBoost, reciprocalRankFusion, rerank } from './index';

describe('reciprocalRankFusion', () => {
  it('promotes items ranked well by multiple scorers', () => {
    const bm25 = [
      { key: 'a', score: 12 },
      { key: 'b', score: 8 },
      { key: 'c', score: 1 },
    ];
    const vector = [
      { key: 'b', score: 0.9 },
      { key: 'a', score: 0.8 },
      { key: 'd', score: 0.2 },
    ];
    const fused = reciprocalRankFusion([bm25, vector]);
    expect(
      fused
        .map((item) => item.key)
        .slice(0, 2)
        .sort((x, y) => x.localeCompare(y)),
    ).toEqual(['a', 'b']);
    expect(fused.map((item) => item.key)).toContain('d');
  });

  it('handles empty input', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });
});

describe('rerank', () => {
  it('reorders items by the boost function', () => {
    const items = [
      { key: 'stale', score: 1 },
      { key: 'fresh', score: 0.9 },
    ];
    const boosted = rerank(items, (key) => (key === 'fresh' ? 2 : 1));
    expect(boosted[0].key).toBe('fresh');
    expect(boosted[0].score).toBeCloseTo(1.8);
  });
});

describe('recencyBoost', () => {
  const now = new Date('2026-07-01T00:00:00Z');

  it('boosts fresh documents over stale ones', () => {
    const fresh = recencyBoost('2026-06-30T00:00:00Z', now);
    const stale = recencyBoost('2020-01-01T00:00:00Z', now);
    expect(fresh).toBeGreaterThan(stale);
    expect(fresh).toBeLessThanOrEqual(1.5);
    expect(stale).toBeGreaterThan(0.5);
  });

  it('is neutral for invalid or future timestamps', () => {
    expect(recencyBoost('not-a-date', now)).toBe(1);
    expect(recencyBoost('2030-01-01T00:00:00Z', now)).toBe(1);
  });
});
