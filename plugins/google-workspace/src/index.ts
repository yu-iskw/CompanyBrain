/**
 * Google Workspace source plugin (Docs/Drive). Drive sharing settings map
 * directly onto the ACL snapshot; Workspace remains authoritative.
 */
import { definePlugin } from '@companybrain/plugin-sdk';

import type { AccessControlList, KnowledgeObject } from '@companybrain/domain';
import type { CompanyBrainPlugin } from '@companybrain/plugin-protocol';

export interface DriveDocument {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly url: string;
  readonly updatedAt: string;
  readonly sharing: 'domain' | 'restricted';
  readonly sharedWithUsers?: readonly string[];
  readonly sharedWithGroups?: readonly string[];
  readonly folder?: string;
}

function toAcl(document: DriveDocument): AccessControlList {
  if (document.sharing === 'domain') {
    return { visibility: 'public', allowedPrincipals: [], allowedGroups: [] };
  }
  return {
    visibility: 'restricted',
    allowedPrincipals: [...(document.sharedWithUsers ?? [])],
    allowedGroups: [...(document.sharedWithGroups ?? [])],
  };
}

const SOURCE = 'google-workspace';

export function toKnowledgeObject(document: DriveDocument): KnowledgeObject {
  return {
    ref: { source: SOURCE, type: 'document', id: document.id },
    title: document.title,
    content: document.text,
    uri: document.url,
    updatedAt: document.updatedAt,
    metadata: new Map(document.folder === undefined ? [] : [['folder', document.folder]]),
    acl: toAcl(document),
  };
}

export function createGoogleWorkspacePlugin(
  documents: readonly DriveDocument[],
): CompanyBrainPlugin {
  const objects = documents.map((document) => toKnowledgeObject(document));
  return definePlugin({
    manifest: {
      name: SOURCE,
      version: '0.1.0',
      source: SOURCE,
      capabilities: ['crawler', 'retriever'],
      scopes: ['drive:readonly', 'docs:readonly'],
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
