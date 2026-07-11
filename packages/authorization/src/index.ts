/**
 * Permission-aware access decisions.
 *
 * Decisions are derived from the ACL snapshot reported by the authoritative
 * source system. CompanyBrain never grants access the source did not grant;
 * further restriction happens in the policy layer on top of these decisions.
 */
import type { KnowledgeObject, Principal } from '@companybrain/domain';

export interface AccessDecision {
  readonly allowed: boolean;
  /** Human-readable explanation, used by the explain_access MCP tool. */
  readonly reason: string;
}

export function canAccess(principal: Principal, object: KnowledgeObject): AccessDecision {
  const { acl } = object;
  if (acl.visibility === 'public') {
    return { allowed: true, reason: 'object is public in its source system' };
  }
  if (acl.allowedPrincipals.includes(principal.id)) {
    return {
      allowed: true,
      reason: `principal "${principal.id}" is allowed by the source system ACL`,
    };
  }
  const matchedGroup = principal.groups.find((group) => acl.allowedGroups.includes(group));
  if (matchedGroup !== undefined) {
    return {
      allowed: true,
      reason: `group "${matchedGroup}" is allowed by the source system ACL`,
    };
  }
  return {
    allowed: false,
    reason: `principal "${principal.id}" is not in the source system ACL`,
  };
}

export interface AccessPartition {
  readonly accessible: KnowledgeObject[];
  readonly deniedCount: number;
}

/** Splits objects into those the principal may see and a count of the rest. */
export function partitionByAccess(
  principal: Principal,
  objects: readonly KnowledgeObject[],
): AccessPartition {
  const accessible: KnowledgeObject[] = [];
  let deniedCount = 0;
  for (const object of objects) {
    if (canAccess(principal, object).allowed) {
      accessible.push(object);
    } else {
      deniedCount += 1;
    }
  }
  return { accessible, deniedCount };
}
