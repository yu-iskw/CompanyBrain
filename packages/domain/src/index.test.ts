import { describe, expect, it } from 'vitest';

import {
  isKnowledgeObjectType,
  KNOWLEDGE_OBJECT_TYPES,
  knowledgeObjectKey,
  parseKnowledgeObjectKey,
} from './index';

describe('knowledge object types', () => {
  it('covers the representative types from the RFC', () => {
    expect(KNOWLEDGE_OBJECT_TYPES).toContain('document');
    expect(KNOWLEDGE_OBJECT_TYPES).toContain('pull-request');
    expect(KNOWLEDGE_OBJECT_TYPES).toContain('semantic-model');
    expect(KNOWLEDGE_OBJECT_TYPES).toContain('mcp-tool');
  });

  it('validates type strings', () => {
    expect(isKnowledgeObjectType('issue')).toBe(true);
    expect(isKnowledgeObjectType('spreadsheet')).toBe(false);
  });
});

describe('knowledgeObjectKey', () => {
  it('round-trips through parseKnowledgeObjectKey', () => {
    const ref = { source: 'github', type: 'issue', id: 'org/repo#42' } as const;
    const key = knowledgeObjectKey(ref);
    expect(key).toBe('github:issue:org/repo#42');
    expect(parseKnowledgeObjectKey(key)).toEqual(ref);
  });

  it('preserves ids that contain colons', () => {
    const ref = { source: 'bigquery', type: 'table', id: 'proj:ds:tbl' } as const;
    expect(parseKnowledgeObjectKey(knowledgeObjectKey(ref))).toEqual(ref);
  });

  it('rejects malformed keys', () => {
    expect(parseKnowledgeObjectKey('github')).toBeUndefined();
    expect(parseKnowledgeObjectKey('github:not-a-type:1')).toBeUndefined();
    expect(parseKnowledgeObjectKey('github:issue')).toBeUndefined();
  });
});
