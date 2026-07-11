import { describe, expect, it } from 'vitest';

import { canAccess, partitionByAccess } from './index';

import type { AccessControlList, KnowledgeObject, Principal } from '@companybrain/domain';

function objectWithAcl(acl: AccessControlList, id = '1'): KnowledgeObject {
  return {
    ref: { source: 'github', type: 'issue', id },
    title: 'Test',
    content: 'Body',
    uri: `https://example.com/${id}`,
    updatedAt: '2026-07-01T00:00:00Z',
    metadata: new Map(),
    acl,
  };
}

const alice: Principal = { id: 'alice', groups: ['engineering'] };

describe('canAccess', () => {
  it('allows public objects for anyone', () => {
    const decision = canAccess(
      alice,
      objectWithAcl({ visibility: 'public', allowedPrincipals: [], allowedGroups: [] }),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain('public');
  });

  it('allows explicitly listed principals', () => {
    const decision = canAccess(
      alice,
      objectWithAcl({ visibility: 'restricted', allowedPrincipals: ['alice'], allowedGroups: [] }),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain('alice');
  });

  it('allows via group membership', () => {
    const decision = canAccess(
      alice,
      objectWithAcl({
        visibility: 'restricted',
        allowedPrincipals: [],
        allowedGroups: ['engineering'],
      }),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain('engineering');
  });

  it('denies principals the source system did not allow', () => {
    const decision = canAccess(
      alice,
      objectWithAcl({
        visibility: 'restricted',
        allowedPrincipals: ['bob'],
        allowedGroups: ['sales'],
      }),
    );
    expect(decision.allowed).toBe(false);
  });
});

describe('partitionByAccess', () => {
  it('splits accessible objects from denied ones', () => {
    const objects = [
      objectWithAcl({ visibility: 'public', allowedPrincipals: [], allowedGroups: [] }, 'pub'),
      objectWithAcl(
        { visibility: 'restricted', allowedPrincipals: ['bob'], allowedGroups: [] },
        'priv',
      ),
    ];
    const { accessible, deniedCount } = partitionByAccess(alice, objects);
    expect(accessible.map((o) => o.ref.id)).toEqual(['pub']);
    expect(deniedCount).toBe(1);
  });
});
