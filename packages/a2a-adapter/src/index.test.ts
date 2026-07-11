import { PluginRegistry, SearchService } from '@companybrain/application';
import { AuditLog } from '@companybrain/audit';
import { PolicyEngine } from '@companybrain/policy';
import { HybridRetriever } from '@companybrain/retrieval';
import { createInMemoryPlugin } from '@companybrain/testing';
import { describe, expect, it } from 'vitest';

import { createAgentCard } from './index';

describe('createAgentCard', () => {
  it('describes the agent and its federated sources', () => {
    const registry = new PluginRegistry();
    registry.register(createInMemoryPlugin('github', []));
    registry.register(createInMemoryPlugin('slack', []));
    const service = new SearchService({
      registry,
      retriever: new HybridRetriever(),
      policyEngine: new PolicyEngine(),
      auditLog: new AuditLog(),
    });
    const card = createAgentCard(service);
    expect(card.name).toBe('companybrain');
    expect(card.skills.map((skill) => skill.id)).toEqual(['search', 'explain_access']);
    expect(card.sources).toEqual(['github', 'slack']);
  });
});
