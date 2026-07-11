/**
 * Typed Knowledge Object model: validation and a human-readable registry of
 * object kinds. Keeps ingestion honest — objects that fail validation are
 * rejected before they reach the index.
 */
import { isKnowledgeObjectType, KNOWLEDGE_OBJECT_TYPES } from '@companybrain/domain';

import type { KnowledgeObject, KnowledgeObjectType } from '@companybrain/domain';

const TYPE_LABELS: ReadonlyMap<KnowledgeObjectType, string> = new Map<KnowledgeObjectType, string>([
  ['document', 'Document'],
  ['repository', 'Repository'],
  ['file', 'File'],
  ['symbol', 'Code Symbol'],
  ['issue', 'Issue'],
  ['pull-request', 'Pull Request'],
  ['slack-thread', 'Slack Thread'],
  ['dataset', 'Dataset'],
  ['table', 'Table'],
  ['dashboard', 'Dashboard'],
  ['metric', 'Metric'],
  ['semantic-model', 'Semantic Model'],
  ['person', 'Person'],
  ['team', 'Team'],
  ['project', 'Project'],
  ['service', 'Service'],
  ['mcp-resource', 'MCP Resource'],
  ['mcp-tool', 'MCP Tool'],
]);

export function objectTypeLabel(type: KnowledgeObjectType): string {
  return TYPE_LABELS.get(type) ?? type;
}

export function listObjectTypes(): readonly KnowledgeObjectType[] {
  return KNOWLEDGE_OBJECT_TYPES;
}

function isIso8601(value: string): boolean {
  return value.includes('T') && !Number.isNaN(Date.parse(value));
}

/** Returns a list of validation errors; empty means the object is valid. */
export function validateKnowledgeObject(object: KnowledgeObject): string[] {
  const errors: string[] = [];
  if (object.ref.source.trim() === '') {
    errors.push('ref.source must not be empty');
  }
  if (object.ref.id.trim() === '') {
    errors.push('ref.id must not be empty');
  }
  if (!isKnowledgeObjectType(object.ref.type)) {
    errors.push(`ref.type "${String(object.ref.type)}" is not a known knowledge object type`);
  }
  if (object.title.trim() === '') {
    errors.push('title must not be empty');
  }
  if (object.uri.trim() === '') {
    errors.push('uri must not be empty');
  }
  if (!isIso8601(object.updatedAt)) {
    errors.push(`updatedAt "${object.updatedAt}" is not an ISO-8601 timestamp`);
  }
  if (
    object.acl.visibility === 'restricted' &&
    object.acl.allowedPrincipals.length === 0 &&
    object.acl.allowedGroups.length === 0
  ) {
    errors.push('restricted ACL must allow at least one principal or group');
  }
  return errors;
}
