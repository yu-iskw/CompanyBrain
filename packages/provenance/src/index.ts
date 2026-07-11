/**
 * Provenance: every answer includes citations pointing back to the
 * authoritative source system. Citations get short stable ids so agents can
 * later resolve them (MCP tool: resolve_citation).
 */
import { createHash } from 'node:crypto';

import { knowledgeObjectKey } from '@companybrain/domain';

import type { KnowledgeObject } from '@companybrain/domain';

export interface Citation {
  /** Short stable id, derived from the object key. */
  readonly id: string;
  readonly sourceSystem: string;
  readonly objectKey: string;
  readonly title: string;
  readonly uri: string;
  readonly snippet: string;
}

export function citationId(objectKey: string): string {
  return createHash('sha256').update(objectKey).digest('hex').slice(0, 12);
}

/** Builds a short snippet around the first query term found in the content. */
export function makeSnippet(content: string, query: string, maxLength = 200): string {
  const haystack = content.toLowerCase();
  const term = query
    .toLowerCase()
    .split(/\s+/)
    .find((t) => t.length > 0 && haystack.includes(t));
  if (term === undefined) {
    return content.slice(0, maxLength);
  }
  const index = haystack.indexOf(term);
  const start = Math.max(0, index - Math.floor(maxLength / 2));
  const snippet = content.slice(start, start + maxLength);
  return (start > 0 ? '…' : '') + snippet;
}

export function createCitation(object: KnowledgeObject, query: string): Citation {
  const objectKey = knowledgeObjectKey(object.ref);
  return {
    id: citationId(objectKey),
    sourceSystem: object.ref.source,
    objectKey,
    title: object.title,
    uri: object.uri,
    snippet: makeSnippet(object.content, query),
  };
}

/** Registry used to resolve citation ids back to their citations. */
export class CitationStore {
  private readonly citations = new Map<string, Citation>();

  register(citation: Citation): void {
    this.citations.set(citation.id, citation);
  }

  resolve(id: string): Citation | undefined {
    return this.citations.get(id);
  }
}
