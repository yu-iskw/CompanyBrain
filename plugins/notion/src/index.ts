/**
 * Notion source plugin. Workspace pages map to public visibility; pages
 * shared with specific people or groups restrict accordingly.
 */
import { definePlugin } from '@companybrain/plugin-sdk';

import type { AccessControlList, KnowledgeObject } from '@companybrain/domain';
import type { CompanyBrainPlugin } from '@companybrain/plugin-protocol';

export interface NotionPage {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly url: string;
  readonly updatedAt: string;
  readonly access: 'workspace' | 'invited';
  readonly invitedUsers?: readonly string[];
  readonly invitedGroups?: readonly string[];
  readonly database?: string;
}

function toAcl(page: NotionPage): AccessControlList {
  if (page.access === 'workspace') {
    return { visibility: 'public', allowedPrincipals: [], allowedGroups: [] };
  }
  return {
    visibility: 'restricted',
    allowedPrincipals: [...(page.invitedUsers ?? [])],
    allowedGroups: [...(page.invitedGroups ?? [])],
  };
}

export function toKnowledgeObject(page: NotionPage): KnowledgeObject {
  return {
    ref: { source: 'notion', type: 'document', id: page.id },
    title: page.title,
    content: page.text,
    uri: page.url,
    updatedAt: page.updatedAt,
    metadata: new Map(page.database === undefined ? [] : [['database', page.database]]),
    acl: toAcl(page),
  };
}

export function createNotionPlugin(pages: readonly NotionPage[]): CompanyBrainPlugin {
  const objects = pages.map((page) => toKnowledgeObject(page));
  return definePlugin({
    manifest: {
      name: 'notion',
      version: '0.1.0',
      source: 'notion',
      capabilities: ['crawler', 'retriever'],
      scopes: ['notion:read:pages'],
    },
    crawler: { crawl: () => Promise.resolve(objects) },
    retriever: {
      retrieve: (_principal, query) =>
        Promise.resolve(
          objects.filter((object) =>
            `${object.title} ${object.content}`.toLowerCase().includes(query.toLowerCase()),
          ),
        ),
    },
  });
}
