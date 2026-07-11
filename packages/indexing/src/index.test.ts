import { describe, expect, it } from 'vitest';

import {
  Bm25Index,
  cosineSimilarity,
  embedText,
  EMBEDDING_DIMENSIONS,
  tokenize,
  VectorIndex,
} from './index';

describe('tokenize', () => {
  it('lowercases, splits on non-alphanumerics, and drops single characters', () => {
    expect(tokenize('Hello, World! A B2B-plan')).toEqual(['hello', 'world', 'b2b', 'plan']);
  });
});

describe('Bm25Index', () => {
  it('ranks documents mentioning the query terms highest', () => {
    const index = new Bm25Index();
    index.add('a', 'incident response runbook and escalation contacts');
    index.add('b', 'quarterly marketing plan and campaign schedule');
    index.add('c', 'postmortem of the march production incident');
    const results = index.search('production incident');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].key).toBe('c');
    expect(results.map((r) => r.key)).not.toContain('b');
  });

  it('replaces documents when re-adding the same key', () => {
    const index = new Bm25Index();
    index.add('a', 'kubernetes deployment guide');
    index.add('a', 'holiday calendar');
    expect(index.size()).toBe(1);
    expect(index.search('kubernetes')).toEqual([]);
    expect(index.search('holiday')[0].key).toBe('a');
  });

  it('supports removal and empty queries', () => {
    const index = new Bm25Index();
    index.add('a', 'terraform modules');
    index.remove('a');
    index.remove('missing');
    expect(index.search('terraform')).toEqual([]);
    expect(index.search('')).toEqual([]);
  });
});

describe('embeddings', () => {
  it('produces unit vectors of fixed dimensionality', () => {
    const vector = embedText('federated enterprise search');
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('is deterministic and reflects token overlap', () => {
    expect(embedText('alpha beta')).toEqual(embedText('alpha beta'));
    const query = embedText('database migration');
    const related = embedText('the database migration plan');
    const unrelated = embedText('office party photos');
    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated));
  });

  it('rejects mismatched dimensionality', () => {
    expect(() => cosineSimilarity([1, 0], [1])).toThrow(/dimensionality/);
  });
});

describe('VectorIndex', () => {
  it('returns nearest neighbours by cosine similarity', () => {
    const index = new VectorIndex();
    index.add('db', embedText('database migration plan'));
    index.add('party', embedText('office party photos'));
    const results = index.search(embedText('database migration'));
    expect(results[0].key).toBe('db');
  });

  it('supports removal', () => {
    const index = new VectorIndex();
    index.add('a', embedText('anything'));
    expect(index.size()).toBe(1);
    index.remove('a');
    expect(index.size()).toBe(0);
  });
});
