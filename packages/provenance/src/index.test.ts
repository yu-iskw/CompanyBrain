import { describe, expect, it } from 'vitest';

import { citationId, CitationStore, createCitation, makeSnippet } from './index';

import type { KnowledgeObject } from '@companybrain/domain';

const object: KnowledgeObject = {
  ref: { source: 'notion', type: 'document', id: 'onboarding' },
  title: 'Onboarding guide',
  content: 'Welcome! This guide covers laptop setup, accounts, and the onboarding checklist.',
  uri: 'https://notion.example.com/onboarding',
  updatedAt: '2026-07-01T00:00:00Z',
  metadata: new Map(),
  acl: { visibility: 'public', allowedPrincipals: [], allowedGroups: [] },
};

describe('createCitation', () => {
  it('captures provenance back to the source system', () => {
    const citation = createCitation(object, 'onboarding checklist');
    expect(citation.sourceSystem).toBe('notion');
    expect(citation.objectKey).toBe('notion:document:onboarding');
    expect(citation.uri).toBe(object.uri);
    expect(citation.snippet).toContain('onboarding');
  });

  it('derives stable short ids from the object key', () => {
    expect(citationId('a:document:b')).toBe(citationId('a:document:b'));
    expect(citationId('a:document:b')).toHaveLength(12);
    expect(citationId('a:document:b')).not.toBe(citationId('a:document:c'));
  });
});

describe('makeSnippet', () => {
  it('centers the snippet on the first matching term', () => {
    const content = `${'x'.repeat(500)} the secret keyword appears here ${'y'.repeat(500)}`;
    const snippet = makeSnippet(content, 'keyword');
    expect(snippet).toContain('keyword');
    expect(snippet.length).toBeLessThanOrEqual(201); // ellipsis + maxLength
    expect(snippet.startsWith('…')).toBe(true);
  });

  it('falls back to the head of the content when nothing matches', () => {
    expect(makeSnippet('short content', 'zzz')).toBe('short content');
  });
});

describe('CitationStore', () => {
  it('resolves registered citations by id', () => {
    const store = new CitationStore();
    const citation = createCitation(object, 'guide');
    store.register(citation);
    expect(store.resolve(citation.id)).toEqual(citation);
    expect(store.resolve('unknown')).toBeUndefined();
  });
});
