import { describe, expect, it } from 'vitest';

import { createNotionPlugin, toKnowledgeObject } from './index';

import type { NotionPage } from './index';

const workspacePage: NotionPage = {
  id: 'page-1',
  title: 'Engineering handbook',
  text: 'How we build, review, and ship software.',
  url: 'https://notion.so/page-1',
  updatedAt: '2026-04-01T00:00:00Z',
  access: 'workspace',
  database: 'handbook',
};

const invitedPage: NotionPage = {
  id: 'page-2',
  title: 'Acquisition plan',
  text: 'Confidential acquisition planning.',
  url: 'https://notion.so/page-2',
  updatedAt: '2026-04-02T00:00:00Z',
  access: 'invited',
  invitedUsers: ['ceo'],
  invitedGroups: ['corp-dev'],
};

describe('notion plugin', () => {
  it('maps page access to ACLs', () => {
    expect(toKnowledgeObject(workspacePage).acl.visibility).toBe('public');
    expect(toKnowledgeObject(workspacePage).metadata.get('database')).toBe('handbook');
    expect(toKnowledgeObject(invitedPage).acl).toEqual({
      visibility: 'restricted',
      allowedPrincipals: ['ceo'],
      allowedGroups: ['corp-dev'],
    });
  });

  it('crawls and retrieves pages', async () => {
    const plugin = createNotionPlugin([workspacePage, invitedPage]);
    expect(plugin.manifest.capabilities).toEqual(['crawler', 'retriever']);
    await expect(plugin.crawler?.crawl()).resolves.toHaveLength(2);
    const hits = await plugin.retriever?.retrieve({ id: 'u', groups: [] }, 'handbook');
    expect(hits?.map((o) => o.ref.id)).toEqual(['page-1']);
  });
});
