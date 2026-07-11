import { PluginRegistry, SearchService } from '@companybrain/application';
import { AuditLog } from '@companybrain/audit';
import { PolicyEngine } from '@companybrain/policy';
import { HybridRetriever } from '@companybrain/retrieval';
import { describe, expect, it } from 'vitest';

import { McpToolSet } from './index';

import type { KnowledgeObject, Principal } from '@companybrain/domain';

const alice: Principal = { id: 'alice', groups: [] };

function makeToolSet(): McpToolSet {
  const retriever = new HybridRetriever(() => new Date('2026-07-01T00:00:00Z'));
  const objects: KnowledgeObject[] = [
    {
      ref: { source: 'notion', type: 'document', id: 'onboarding' },
      title: 'Onboarding guide',
      content: 'Laptop setup, accounts, and the onboarding checklist.',
      uri: 'https://notion.example.com/onboarding',
      updatedAt: '2026-06-20T00:00:00Z',
      metadata: new Map([['space', 'people-ops']]),
      acl: { visibility: 'public', allowedPrincipals: [], allowedGroups: [] },
    },
    {
      ref: { source: 'github', type: 'issue', id: '42' },
      title: 'Onboarding docs are stale',
      content: 'The onboarding docs mention retired tools.',
      uri: 'https://github.com/org/repo/issues/42',
      updatedAt: '2026-06-25T00:00:00Z',
      metadata: new Map(),
      acl: { visibility: 'restricted', allowedPrincipals: ['bob'], allowedGroups: [] },
    },
  ];
  for (const object of objects) {
    retriever.index(object);
  }
  const registry = new PluginRegistry();
  registry.register({
    manifest: {
      name: 'notion',
      version: '1.0.0',
      source: 'notion',
      capabilities: ['retriever'],
      scopes: ['notion:read'],
    },
    retriever: { retrieve: () => Promise.resolve([]) },
  });
  const service = new SearchService({
    registry,
    retriever,
    policyEngine: new PolicyEngine(),
    auditLog: new AuditLog(),
  });
  return new McpToolSet(service);
}

describe('McpToolSet', () => {
  it('exposes the five Phase 1 tools', () => {
    const names = makeToolSet()
      .listTools()
      .map((tool) => tool.name)
      .sort((a, b) => a.localeCompare(b));
    expect(names).toEqual([
      'explain_access',
      'get_object',
      'list_sources',
      'resolve_citation',
      'search',
    ]);
  });

  it('search returns permission-filtered results with citations', async () => {
    const tools = makeToolSet();
    const result = await tools.callTool(alice, 'search', { query: 'onboarding' });
    expect(result.isError).toBe(false);
    const content = result.content as { results: Array<{ key: string; citation: { id: string } }> };
    expect(content.results.map((r) => r.key)).toEqual(['notion:document:onboarding']);
  });

  it('get_object enforces access and returns metadata', async () => {
    const tools = makeToolSet();
    const found = await tools.callTool(alice, 'get_object', { key: 'notion:document:onboarding' });
    expect(found.isError).toBe(false);
    expect((found.content as { metadata: Record<string, string> }).metadata).toEqual({
      space: 'people-ops',
    });
    const denied = await tools.callTool(alice, 'get_object', { key: 'github:issue:42' });
    expect(denied.isError).toBe(true);
  });

  it('resolve_citation round-trips citations from search', async () => {
    const tools = makeToolSet();
    const search = await tools.callTool(alice, 'search', { query: 'onboarding' });
    const citationId = (search.content as { results: Array<{ citation: { id: string } }> })
      .results[0].citation.id;
    const resolved = await tools.callTool(alice, 'resolve_citation', { citation_id: citationId });
    expect(resolved.isError).toBe(false);
    expect((resolved.content as { objectKey: string }).objectKey).toBe(
      'notion:document:onboarding',
    );
  });

  it('list_sources and explain_access work end to end', async () => {
    const tools = makeToolSet();
    const sources = await tools.callTool(alice, 'list_sources', {});
    expect((sources.content as { sources: Array<{ source: string }> }).sources[0].source).toBe(
      'notion',
    );
    const explanation = await tools.callTool(alice, 'explain_access', { key: 'github:issue:42' });
    const content = explanation.content as { allowed: boolean; trace: string[] };
    expect(content.allowed).toBe(false);
    expect(content.trace.length).toBeGreaterThan(0);
  });

  it('rejects unknown tools, missing args, and bad type filters', async () => {
    const tools = makeToolSet();
    expect((await tools.callTool(alice, 'delete_everything', {})).isError).toBe(true);
    expect((await tools.callTool(alice, 'search', {})).isError).toBe(true);
    expect(
      (await tools.callTool(alice, 'search', { query: 'x', type: 'spreadsheet' })).isError,
    ).toBe(true);
    expect((await tools.callTool(alice, 'get_object', {})).isError).toBe(true);
    expect((await tools.callTool(alice, 'resolve_citation', {})).isError).toBe(true);
    expect((await tools.callTool(alice, 'explain_access', {})).isError).toBe(true);
  });
});
