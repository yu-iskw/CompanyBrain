import { describe, expect, it } from 'vitest';

import { createGithubPlugin, toKnowledgeObject } from './index';

import type { GithubRecord } from './index';

const publicIssue: GithubRecord = {
  kind: 'issue',
  id: 'org/repo#42',
  title: 'Login fails on Safari',
  body: 'Steps to reproduce the login failure...',
  url: 'https://github.com/org/repo/issues/42',
  updatedAt: '2026-06-01T00:00:00Z',
  visibility: 'public',
  labels: ['bug', 'auth'],
};

const privatePr: GithubRecord = {
  kind: 'pull-request',
  id: 'org/internal#7',
  title: 'Rotate signing keys',
  body: 'Rotates the signing keys.',
  url: 'https://github.com/org/internal/pull/7',
  updatedAt: '2026-06-02T00:00:00Z',
  visibility: 'private',
  teamMembers: ['alice', 'bob'],
};

describe('toKnowledgeObject', () => {
  it('maps public records to public ACLs with metadata', () => {
    const object = toKnowledgeObject(publicIssue);
    expect(object.ref).toEqual({ source: 'github', type: 'issue', id: 'org/repo#42' });
    expect(object.acl.visibility).toBe('public');
    expect(object.metadata.get('labels')).toBe('bug,auth');
  });

  it('restricts private records to team members', () => {
    const object = toKnowledgeObject(privatePr);
    expect(object.acl).toEqual({
      visibility: 'restricted',
      allowedPrincipals: ['alice', 'bob'],
      allowedGroups: [],
    });
  });
});

describe('createGithubPlugin', () => {
  it('declares full capabilities and serves records', async () => {
    const plugin = createGithubPlugin([publicIssue, privatePr]);
    expect(plugin.manifest.capabilities).toEqual([
      'crawler',
      'retriever',
      'metadata-provider',
      'webhook-handler',
    ]);
    await expect(plugin.crawler?.crawl()).resolves.toHaveLength(2);
    const hits = await plugin.retriever?.retrieve({ id: 'alice', groups: [] }, 'login');
    expect(hits?.map((o) => o.ref.id)).toEqual(['org/repo#42']);
    const metadata = await plugin.metadataProvider?.getMetadata({
      source: 'github',
      type: 'issue',
      id: 'org/repo#42',
    });
    expect(metadata?.get('kind')).toBe('issue');
  });

  it('converts webhook payloads into updated objects', async () => {
    const plugin = createGithubPlugin([]);
    const changed = await plugin.webhookHandler?.handleWebhook({
      type: 'issues.opened',
      payload: { record: publicIssue },
    });
    expect(changed?.map((o) => o.ref.id)).toEqual(['org/repo#42']);
    await expect(
      plugin.webhookHandler?.handleWebhook({ type: 'ping', payload: {} }),
    ).resolves.toEqual([]);
  });
});
