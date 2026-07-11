/**
 * Core domain model for CompanyBrain.
 *
 * CompanyBrain is federated: source systems remain authoritative for both
 * content and authorization. Every entity here references its source system
 * and carries the ACL snapshot the source reported at crawl time.
 */

export const KNOWLEDGE_OBJECT_TYPES = [
  'document',
  'repository',
  'file',
  'symbol',
  'issue',
  'pull-request',
  'slack-thread',
  'dataset',
  'table',
  'dashboard',
  'metric',
  'semantic-model',
  'person',
  'team',
  'project',
  'service',
  'mcp-resource',
  'mcp-tool',
] as const;

export type KnowledgeObjectType = (typeof KNOWLEDGE_OBJECT_TYPES)[number];

export function isKnowledgeObjectType(value: string): value is KnowledgeObjectType {
  return (KNOWLEDGE_OBJECT_TYPES as readonly string[]).includes(value);
}

/** Identity of an object inside its authoritative source system. */
export interface KnowledgeObjectRef {
  /** Source system identifier, e.g. "github", "slack". */
  readonly source: string;
  readonly type: KnowledgeObjectType;
  /** Identifier that is unique within (source, type). */
  readonly id: string;
}

/** Stable, globally unique key for a knowledge object. */
export function knowledgeObjectKey(ref: KnowledgeObjectRef): string {
  return `${ref.source}:${ref.type}:${ref.id}`;
}

export function parseKnowledgeObjectKey(key: string): KnowledgeObjectRef | undefined {
  const [source, type, ...rest] = key.split(':');
  if (!source || !type || rest.length === 0 || !isKnowledgeObjectType(type)) {
    return undefined;
  }
  return { source, type, id: rest.join(':') };
}

/**
 * ACL snapshot as reported by the authoritative source system.
 * CompanyBrain enforces this snapshot and may only restrict further.
 */
export interface AccessControlList {
  readonly visibility: 'public' | 'restricted';
  /** Principal ids allowed when visibility is "restricted". */
  readonly allowedPrincipals: readonly string[];
  /** Group ids allowed when visibility is "restricted". */
  readonly allowedGroups: readonly string[];
}

export const PUBLIC_ACL: AccessControlList = {
  visibility: 'public',
  allowedPrincipals: [],
  allowedGroups: [],
};

/** A user (or delegated agent acting as a user) making requests. */
export interface Principal {
  readonly id: string;
  readonly groups: readonly string[];
}

/** The core entity: a typed, permissioned pointer into a source system. */
export interface KnowledgeObject {
  readonly ref: KnowledgeObjectRef;
  readonly title: string;
  /** Indexable text content (may be a summary; source stays authoritative). */
  readonly content: string;
  /** Canonical URI in the source system. */
  readonly uri: string;
  /** ISO-8601 timestamp of the last known update in the source system. */
  readonly updatedAt: string;
  readonly metadata: ReadonlyMap<string, string>;
  readonly acl: AccessControlList;
}
