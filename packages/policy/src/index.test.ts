import { describe, expect, it } from 'vitest';

import { denyMetadata, denyObjectType, denySourceSystem, PolicyEngine } from './index';

import type { KnowledgeObject, Principal } from '@companybrain/domain';

const alice: Principal = { id: 'alice', groups: [] };

function object(
  overrides: {
    source?: string;
    type?: KnowledgeObject['ref']['type'];
    metadata?: Map<string, string>;
  } = {},
): KnowledgeObject {
  return {
    ref: { source: overrides.source ?? 'github', type: overrides.type ?? 'issue', id: '1' },
    title: 'Test',
    content: 'Body',
    uri: 'https://example.com/1',
    updatedAt: '2026-07-01T00:00:00Z',
    metadata: overrides.metadata ?? new Map(),
    acl: { visibility: 'public', allowedPrincipals: [], allowedGroups: [] },
  };
}

const sourceAllows = { allowed: true, reason: 'object is public in its source system' };
const sourceDenies = { allowed: false, reason: 'principal not in ACL' };

describe('PolicyEngine', () => {
  it('allows when the source allows and no rule denies', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate({ principal: alice, object: object() }, sourceAllows);
    expect(decision.allowed).toBe(true);
    expect(decision.trace.some((line) => line.includes('no policy restricts'))).toBe(true);
  });

  it('never expands access beyond the source decision', () => {
    const engine = new PolicyEngine();
    const decision = engine.evaluate({ principal: alice, object: object() }, sourceDenies);
    expect(decision.allowed).toBe(false);
    expect(decision.trace.some((line) => line.includes('denied by source system'))).toBe(true);
  });

  it('restricts by source system', () => {
    const engine = new PolicyEngine();
    engine.addRule(denySourceSystem('slack'));
    const denied = engine.evaluate(
      { principal: alice, object: object({ source: 'slack' }) },
      sourceAllows,
    );
    expect(denied.allowed).toBe(false);
    expect(denied.deniedByRules).toEqual(['deny-source:slack']);
    const allowed = engine.evaluate({ principal: alice, object: object() }, sourceAllows);
    expect(allowed.allowed).toBe(true);
  });

  it('restricts by object type and metadata markers', () => {
    const engine = new PolicyEngine();
    engine.addRule(denyObjectType('dashboard'));
    engine.addRule(denyMetadata('classification', 'secret'));
    expect(
      engine.evaluate({ principal: alice, object: object({ type: 'dashboard' }) }, sourceAllows)
        .allowed,
    ).toBe(false);
    expect(
      engine.evaluate(
        { principal: alice, object: object({ metadata: new Map([['classification', 'secret']]) }) },
        sourceAllows,
      ).allowed,
    ).toBe(false);
    expect(engine.evaluate({ principal: alice, object: object() }, sourceAllows).allowed).toBe(
      true,
    );
  });

  it('rejects duplicate rule ids and lists registered rules', () => {
    const engine = new PolicyEngine();
    engine.addRule(denySourceSystem('slack'));
    expect(() => engine.addRule(denySourceSystem('slack'))).toThrow(/already registered/);
    expect(engine.listRules()).toHaveLength(1);
  });
});
