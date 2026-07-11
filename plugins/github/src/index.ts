/**
 * GitHub source plugin. Federated: GitHub stays authoritative; records are
 * injected by the caller (production wires an API client honouring the
 * plugin's scoped credential; tests inject fixtures).
 */
import { definePlugin } from '@companybrain/plugin-sdk';

import type { AccessControlList, KnowledgeObject, KnowledgeObjectType } from '@companybrain/domain';
import type { CompanyBrainPlugin } from '@companybrain/plugin-protocol';

export interface GithubRecord {
  readonly kind: 'repository' | 'issue' | 'pull-request' | 'file';
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly updatedAt: string;
  /** Repo visibility drives the ACL; private repos restrict to team members. */
  readonly visibility: 'public' | 'private';
  readonly teamMembers?: readonly string[];
  readonly labels?: readonly string[];
}

function toAcl(record: GithubRecord): AccessControlList {
  if (record.visibility === 'public') {
    return { visibility: 'public', allowedPrincipals: [], allowedGroups: [] };
  }
  return {
    visibility: 'restricted',
    allowedPrincipals: [...(record.teamMembers ?? [])],
    allowedGroups: [],
  };
}

export function toKnowledgeObject(record: GithubRecord): KnowledgeObject {
  const type: KnowledgeObjectType = record.kind;
  return {
    ref: { source: 'github', type, id: record.id },
    title: record.title,
    content: record.body,
    uri: record.url,
    updatedAt: record.updatedAt,
    metadata: new Map([
      ['kind', record.kind],
      ...(record.labels === undefined ? [] : [['labels', record.labels.join(',')] as const]),
    ]),
    acl: toAcl(record),
  };
}

export function createGithubPlugin(records: readonly GithubRecord[]): CompanyBrainPlugin {
  const objects = records.map((record) => toKnowledgeObject(record));
  return definePlugin({
    manifest: {
      name: 'github',
      version: '0.1.0',
      source: 'github',
      capabilities: ['crawler', 'retriever', 'metadata-provider', 'webhook-handler'],
      scopes: ['github:read:repos', 'github:read:issues', 'github:read:pull-requests'],
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
    metadataProvider: {
      getMetadata: (ref) =>
        Promise.resolve(objects.find((object) => object.ref.id === ref.id)?.metadata),
    },
    webhookHandler: {
      handleWebhook: (event) => {
        const record = event.payload.record as GithubRecord | undefined;
        return Promise.resolve(record === undefined ? [] : [toKnowledgeObject(record)]);
      },
    },
  });
}
