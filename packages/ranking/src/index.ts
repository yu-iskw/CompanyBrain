/**
 * Rank fusion and reranking for hybrid retrieval.
 */

export interface RankedItem {
  readonly key: string;
  readonly score: number;
}

/**
 * Reciprocal Rank Fusion: combines rankings from heterogeneous scorers
 * (BM25, vector similarity, ...) without needing calibrated scores.
 */
export function reciprocalRankFusion(
  rankings: ReadonlyArray<readonly RankedItem[]>,
  k = 60,
): RankedItem[] {
  const fused = new Map<string, number>();
  for (const ranking of rankings) {
    for (const [rank, item] of ranking.entries()) {
      fused.set(item.key, (fused.get(item.key) ?? 0) + 1 / (k + rank + 1));
    }
  }
  return [...fused.entries()]
    .map(([key, score]) => ({ key, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Multiplies each item's score by a boost derived from the item key.
 * Used e.g. to boost recently updated objects during reranking.
 */
export function rerank(items: readonly RankedItem[], boost: (key: string) => number): RankedItem[] {
  return items
    .map((item) => ({ key: item.key, score: item.score * boost(item.key) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Recency boost in (0.5, 1.5]: fresh documents gain up to +50%,
 * documents older than the half-life decay towards 0.5.
 */
export function recencyBoost(updatedAt: string, now: Date, halfLifeDays = 180): number {
  const ageMs = now.getTime() - new Date(updatedAt).getTime();
  if (Number.isNaN(ageMs) || ageMs < 0) {
    return 1;
  }
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return 0.5 + 1 / (1 + ageDays / halfLifeDays);
}
