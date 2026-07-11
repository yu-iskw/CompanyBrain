/**
 * A2A adapter (Phase 3 placeholder).
 *
 * Agent-to-agent interop is a roadmap item; Phase 1 only publishes a static
 * agent card describing CompanyBrain's skills so future A2A clients can
 * discover the surface that will be exposed.
 */
import type { SearchService } from '@companybrain/application';

export interface AgentSkill {
  readonly id: string;
  readonly description: string;
}

export interface AgentCard {
  readonly name: string;
  readonly description: string;
  readonly skills: readonly AgentSkill[];
  /** Source systems currently federated behind this agent. */
  readonly sources: readonly string[];
}

export function createAgentCard(service: SearchService): AgentCard {
  return {
    name: 'companybrain',
    description:
      'Governed, permission-aware federated search over enterprise knowledge with provenance.',
    skills: [
      { id: 'search', description: 'Hybrid search across federated sources with citations' },
      { id: 'explain_access', description: 'Explain access decisions for a knowledge object' },
    ],
    sources: service.listSources().map((source) => source.source),
  };
}
