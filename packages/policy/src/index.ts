/**
 * Policy engine.
 *
 * Guiding principle: CompanyBrain may restrict access but never expand it.
 * The engine therefore only evaluates rules when the source-system decision
 * already allows access, and rules can only produce "deny" effects.
 */
import type { AccessDecision } from '@companybrain/authorization';
import type { KnowledgeObject, KnowledgeObjectType, Principal } from '@companybrain/domain';

export interface PolicyContext {
  readonly principal: Principal;
  readonly object: KnowledgeObject;
}

export interface PolicyRule {
  readonly id: string;
  readonly description: string;
  /** Returns true when this rule denies access for the given context. */
  denies(context: PolicyContext): boolean;
}

export interface PolicyDecision {
  readonly allowed: boolean;
  /** Ordered trace of how the decision was reached. */
  readonly trace: readonly string[];
  /** Ids of rules that denied access. */
  readonly deniedByRules: readonly string[];
}

export class PolicyEngine {
  private readonly rules: PolicyRule[] = [];

  addRule(rule: PolicyRule): void {
    if (this.rules.some((existing) => existing.id === rule.id)) {
      throw new Error(`policy rule with id "${rule.id}" is already registered`);
    }
    this.rules.push(rule);
  }

  listRules(): readonly PolicyRule[] {
    return [...this.rules];
  }

  evaluate(context: PolicyContext, sourceDecision: AccessDecision): PolicyDecision {
    const trace: string[] = [`source system: ${sourceDecision.reason}`];
    if (!sourceDecision.allowed) {
      trace.push('denied by source system; policies are not consulted');
      return { allowed: false, trace, deniedByRules: [] };
    }
    const deniedByRules = this.rules
      .filter((rule) => rule.denies(context))
      .map((rule) => {
        trace.push(`policy "${rule.id}" denies: ${rule.description}`);
        return rule.id;
      });
    if (deniedByRules.length === 0) {
      trace.push('no policy restricts access');
    }
    return { allowed: deniedByRules.length === 0, trace, deniedByRules };
  }
}

/** Denies every object from the given source system. */
export function denySourceSystem(source: string): PolicyRule {
  return {
    id: `deny-source:${source}`,
    description: `objects from source "${source}" are not exposed`,
    denies: ({ object }) => object.ref.source === source,
  };
}

/** Denies every object of the given type. */
export function denyObjectType(type: KnowledgeObjectType): PolicyRule {
  return {
    id: `deny-type:${type}`,
    description: `objects of type "${type}" are not exposed`,
    denies: ({ object }) => object.ref.type === type,
  };
}

/** Denies objects carrying a given metadata marker, e.g. classification=secret. */
export function denyMetadata(key: string, value: string): PolicyRule {
  return {
    id: `deny-metadata:${key}=${value}`,
    description: `objects with metadata ${key}=${value} are not exposed`,
    denies: ({ object }) => object.metadata.get(key) === value,
  };
}
