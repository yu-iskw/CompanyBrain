/**
 * Hybrid, permission-aware retrieval.
 *
 * Pipeline: BM25 + vector search → reciprocal rank fusion → metadata filters
 * → permission filtering (source-system ACLs) → recency reranking →
 * citation generation. Permission filtering happens before results are
 * returned, so a caller can never observe objects its principal cannot read.
 */
import { canAccess } from '@companybrain/authorization';
import { knowledgeObjectKey } from '@companybrain/domain';
import { Bm25Index, embedText, VectorIndex } from '@companybrain/indexing';
import { createCitation } from '@companybrain/provenance';
import { recencyBoost, reciprocalRankFusion, rerank } from '@companybrain/ranking';

import type { KnowledgeObject, KnowledgeObjectType, Principal } from '@companybrain/domain';
import type { Citation } from '@companybrain/provenance';

export interface RetrievalFilters {
  readonly source?: string;
  readonly type?: KnowledgeObjectType;
  readonly metadata?: ReadonlyMap<string, string>;
}

export interface RetrievalQuery {
  readonly text: string;
  readonly filters?: RetrievalFilters;
  readonly limit?: number;
}

export interface SearchResult {
  readonly object: KnowledgeObject;
  readonly score: number;
  readonly citation: Citation;
}

function matchesFilters(object: KnowledgeObject, filters: RetrievalFilters | undefined): boolean {
  if (filters === undefined) {
    return true;
  }
  if (filters.source !== undefined && object.ref.source !== filters.source) {
    return false;
  }
  if (filters.type !== undefined && object.ref.type !== filters.type) {
    return false;
  }
  if (filters.metadata !== undefined) {
    for (const [key, value] of filters.metadata) {
      if (object.metadata.get(key) !== value) {
        return false;
      }
    }
  }
  return true;
}

export class HybridRetriever {
  private readonly objects = new Map<string, KnowledgeObject>();
  private readonly bm25 = new Bm25Index();
  private readonly vectors = new VectorIndex();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  index(object: KnowledgeObject): void {
    const key = knowledgeObjectKey(object.ref);
    this.objects.set(key, object);
    const text = `${object.title}\n${object.content}`;
    this.bm25.add(key, text);
    this.vectors.add(key, embedText(text));
  }

  remove(key: string): void {
    this.objects.delete(key);
    this.bm25.remove(key);
    this.vectors.remove(key);
  }

  size(): number {
    return this.objects.size;
  }

  /** Permission-checked point lookup by object key. */
  getObject(principal: Principal, key: string): KnowledgeObject | undefined {
    const object = this.objects.get(key);
    if (object === undefined || !canAccess(principal, object).allowed) {
      return undefined;
    }
    return object;
  }

  /** Unchecked lookup for access-explanation flows; never expose directly. */
  getObjectUnchecked(key: string): KnowledgeObject | undefined {
    return this.objects.get(key);
  }

  search(principal: Principal, query: RetrievalQuery): SearchResult[] {
    const limit = query.limit ?? 10;
    // Over-fetch candidates: later stages only ever remove results.
    const candidateLimit = Math.max(limit * 5, 50);
    const fused = reciprocalRankFusion([
      this.bm25.search(query.text, candidateLimit),
      this.vectors.search(embedText(query.text), candidateLimit),
    ]);
    const now = this.now();
    const visible = fused.filter(({ key }) => {
      const object = this.objects.get(key);
      return (
        object !== undefined &&
        matchesFilters(object, query.filters) &&
        canAccess(principal, object).allowed
      );
    });
    const reranked = rerank(visible, (key) => {
      const object = this.objects.get(key);
      return object === undefined ? 1 : recencyBoost(object.updatedAt, now);
    });
    return reranked.slice(0, limit).flatMap(({ key, score }) => {
      const object = this.objects.get(key);
      if (object === undefined) {
        return [];
      }
      return [{ object, score, citation: createCitation(object, query.text) }];
    });
  }
}
