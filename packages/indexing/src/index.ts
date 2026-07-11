/**
 * Indexing primitives for hybrid search: a BM25 lexical index and a vector
 * index. The embedding used here is a deterministic feature-hashing embedding
 * so the platform runs with no model dependency; production deployments swap
 * in embeddings from the model gateway without changing the index contract.
 */
import { createHash } from 'node:crypto';

export interface ScoredKey {
  readonly key: string;
  readonly score: number;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
}

interface IndexedDocument {
  readonly key: string;
  readonly termFrequencies: Map<string, number>;
  readonly length: number;
}

/** Okapi BM25 over an in-memory inverted index. */
export class Bm25Index {
  private readonly documents = new Map<string, IndexedDocument>();
  private readonly postings = new Map<string, Set<string>>();
  private readonly k1 = 1.2;
  private readonly b = 0.75;

  add(key: string, text: string): void {
    this.remove(key);
    const tokens = tokenize(text);
    const termFrequencies = new Map<string, number>();
    for (const token of tokens) {
      termFrequencies.set(token, (termFrequencies.get(token) ?? 0) + 1);
      let posting = this.postings.get(token);
      if (posting === undefined) {
        posting = new Set();
        this.postings.set(token, posting);
      }
      posting.add(key);
    }
    this.documents.set(key, { key, termFrequencies, length: tokens.length });
  }

  remove(key: string): void {
    const existing = this.documents.get(key);
    if (existing === undefined) {
      return;
    }
    for (const term of existing.termFrequencies.keys()) {
      this.postings.get(term)?.delete(key);
    }
    this.documents.delete(key);
  }

  size(): number {
    return this.documents.size;
  }

  search(query: string, limit = 10): ScoredKey[] {
    const terms = tokenize(query);
    const docCount = this.documents.size;
    if (terms.length === 0 || docCount === 0) {
      return [];
    }
    const averageLength =
      [...this.documents.values()].reduce((sum, doc) => sum + doc.length, 0) / docCount;
    const scores = new Map<string, number>();
    for (const term of terms) {
      const posting = this.postings.get(term);
      if (posting === undefined || posting.size === 0) {
        continue;
      }
      const idf = Math.log(1 + (docCount - posting.size + 0.5) / (posting.size + 0.5));
      for (const key of posting) {
        const doc = this.documents.get(key);
        if (doc === undefined) {
          continue;
        }
        const tf = doc.termFrequencies.get(term) ?? 0;
        const denominator = tf + this.k1 * (1 - this.b + (this.b * doc.length) / averageLength);
        scores.set(key, (scores.get(key) ?? 0) + (idf * tf * (this.k1 + 1)) / denominator);
      }
    }
    return [...scores.entries()]
      .map(([key, score]) => ({ key, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

export const EMBEDDING_DIMENSIONS = 128;

/**
 * Deterministic feature-hashing embedding (model-free placeholder that still
 * gives meaningful token-overlap similarity under cosine distance).
 */
export function embedText(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const token of tokenize(text)) {
    const digest = createHash('sha256').update(token).digest();
    const bucket = digest.readUInt32BE(0) % EMBEDDING_DIMENSIONS;
    const sign = digest.readUInt8(4) % 2 === 0 ? 1 : -1;
    vector.splice(bucket, 1, (vector.at(bucket) ?? 0) + sign);
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return norm === 0 ? vector : vector.map((v) => v / norm);
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error('vectors must have the same dimensionality');
  }
  let dot = 0;
  for (const [i, value] of a.entries()) {
    dot += value * (b.at(i) ?? 0);
  }
  return dot;
}

export class VectorIndex {
  private readonly vectors = new Map<string, readonly number[]>();

  add(key: string, vector: readonly number[]): void {
    this.vectors.set(key, vector);
  }

  remove(key: string): void {
    this.vectors.delete(key);
  }

  size(): number {
    return this.vectors.size;
  }

  search(queryVector: readonly number[], limit = 10): ScoredKey[] {
    return [...this.vectors.entries()]
      .map(([key, vector]) => ({ key, score: cosineSimilarity(queryVector, vector) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
