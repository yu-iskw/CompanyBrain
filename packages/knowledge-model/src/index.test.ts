import { describe, expect, it } from 'vitest';

import { listObjectTypes, objectTypeLabel, validateKnowledgeObject } from './index';

import type { KnowledgeObject } from '@companybrain/domain';

function validObject(): KnowledgeObject {
  return {
    ref: { source: 'github', type: 'issue', id: '42' },
    title: 'Fix login bug',
    content: 'Users cannot log in when...',
    uri: 'https://github.com/org/repo/issues/42',
    updatedAt: '2026-07-01T12:00:00Z',
    metadata: new Map(),
    acl: { visibility: 'public', allowedPrincipals: [], allowedGroups: [] },
  };
}

describe('validateKnowledgeObject', () => {
  it('accepts a valid object', () => {
    expect(validateKnowledgeObject(validObject())).toEqual([]);
  });

  it('rejects empty identity and title fields', () => {
    const object: KnowledgeObject = {
      ...validObject(),
      ref: { source: ' ', type: 'issue', id: '' },
      title: '',
      uri: '',
    };
    const errors = validateKnowledgeObject(object);
    expect(errors).toHaveLength(4);
  });

  it('rejects malformed timestamps', () => {
    const errors = validateKnowledgeObject({ ...validObject(), updatedAt: 'yesterday' });
    expect(errors.some((e) => e.includes('ISO-8601'))).toBe(true);
  });

  it('rejects restricted ACLs that allow nobody', () => {
    const errors = validateKnowledgeObject({
      ...validObject(),
      acl: { visibility: 'restricted', allowedPrincipals: [], allowedGroups: [] },
    });
    expect(errors.some((e) => e.includes('restricted ACL'))).toBe(true);
  });
});

describe('object type registry', () => {
  it('labels every registered type', () => {
    for (const type of listObjectTypes()) {
      expect(objectTypeLabel(type).length).toBeGreaterThan(0);
    }
    expect(objectTypeLabel('pull-request')).toBe('Pull Request');
  });
});
