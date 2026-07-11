/**
 * Application layer: wires plugins, retrieval, policy, provenance, and audit
 * into the governed search services exposed by the API and MCP surfaces.
 */
import { canAccess } from '@companybrain/authorization';
import { CitationStore } from '@companybrain/provenance';

import type { AuditLog } from '@companybrain/audit';
import type { KnowledgeObject, Principal } from '@companybrain/domain';
import type { CompanyBrainPlugin } from '@companybrain/plugin-protocol';
import type { PolicyEngine } from '@companybrain/policy';
import type { Citation } from '@companybrain/provenance';
import type { HybridRetriever, RetrievalQuery, SearchResult } from '@companybrain/retrieval';

export class PluginRegistry {
  private readonly plugins = new Map<string, CompanyBrainPlugin>();

  register(plugin: CompanyBrainPlugin): void {
    const { source } = plugin.manifest;
    if (this.plugins.has(source)) {
      throw new Error(`a plugin for source "${source}" is already registered`);
    }
    this.plugins.set(source, plugin);
  }

  get(source: string): CompanyBrainPlugin | undefined {
    return this.plugins.get(source);
  }

  list(): readonly CompanyBrainPlugin[] {
    return [...this.plugins.values()];
  }
}

export interface SearchServiceDependencies {
  readonly registry: PluginRegistry;
  readonly retriever: HybridRetriever;
  readonly policyEngine: PolicyEngine;
  readonly auditLog: AuditLog;
}

export interface SearchResponse {
  readonly results: readonly SearchResult[];
  readonly auditEventId: string;
}

export interface AccessExplanation {
  readonly objectKey: string;
  readonly allowed: boolean;
  readonly trace: readonly string[];
}

export interface SourceDescription {
  readonly source: string;
  readonly plugin: string;
  readonly version: string;
  readonly capabilities: readonly string[];
}

export class SearchService {
  readonly citations = new CitationStore();
  private readonly deps: SearchServiceDependencies;

  constructor(deps: SearchServiceDependencies) {
    this.deps = deps;
  }

  /** Pulls objects from every crawler-capable plugin into the index. */
  async ingestFromCrawlers(): Promise<number> {
    let count = 0;
    for (const plugin of this.deps.registry.list()) {
      if (plugin.crawler === undefined) {
        continue;
      }
      const objects = await plugin.crawler.crawl();
      for (const object of objects) {
        this.deps.retriever.index(object);
        count += 1;
      }
      this.deps.auditLog.append({
        actor: 'system:worker',
        action: 'ingest',
        resource: plugin.manifest.source,
        details: { objects: objects.length },
      });
    }
    return count;
  }

  /** Applies a single webhook event's changed objects to the index. */
  async applyWebhook(
    source: string,
    event: { type: string; payload: Record<string, unknown> },
  ): Promise<number> {
    const plugin = this.deps.registry.get(source);
    if (plugin?.webhookHandler === undefined) {
      throw new Error(`no webhook-capable plugin for source "${source}"`);
    }
    const changed = await plugin.webhookHandler.handleWebhook(event);
    for (const object of changed) {
      this.deps.retriever.index(object);
    }
    this.deps.auditLog.append({
      actor: 'system:webhook',
      action: 'webhook',
      resource: source,
      details: { eventType: event.type, objects: changed.length },
    });
    return changed.length;
  }

  /** Governed search: retrieval (permission-aware) → policy → audit. */
  search(principal: Principal, query: RetrievalQuery): SearchResponse {
    const retrieved = this.deps.retriever.search(principal, query);
    const results = retrieved.filter((result) => this.policyAllows(principal, result.object));
    for (const result of results) {
      this.citations.register(result.citation);
    }
    const event = this.deps.auditLog.append({
      actor: principal.id,
      action: 'search',
      details: {
        query: query.text,
        retrieved: retrieved.length,
        returned: results.length,
      },
    });
    return { results, auditEventId: event.id };
  }

  /** Governed point lookup by object key. */
  getObject(principal: Principal, key: string): KnowledgeObject | undefined {
    const object = this.deps.retriever.getObject(principal, key);
    const allowed = object !== undefined && this.policyAllows(principal, object);
    this.deps.auditLog.append({
      actor: principal.id,
      action: 'get_object',
      resource: key,
      details: { allowed },
    });
    return allowed ? object : undefined;
  }

  resolveCitation(principal: Principal, citationId: string): Citation | undefined {
    const citation = this.citations.resolve(citationId);
    if (citation === undefined) {
      return undefined;
    }
    // Re-check access at resolution time: permissions may have tightened.
    const object = this.deps.retriever.getObject(principal, citation.objectKey);
    if (object === undefined || !this.policyAllows(principal, object)) {
      return undefined;
    }
    return citation;
  }

  /** Full decision trace for the explain_access tool. */
  explainAccess(principal: Principal, key: string): AccessExplanation {
    const object = this.deps.retriever.getObjectUnchecked(key);
    if (object === undefined) {
      return { objectKey: key, allowed: false, trace: ['object is not indexed'] };
    }
    const sourceDecision = canAccess(principal, object);
    const decision = this.deps.policyEngine.evaluate({ principal, object }, sourceDecision);
    this.deps.auditLog.append({
      actor: principal.id,
      action: 'explain_access',
      resource: key,
      details: { allowed: decision.allowed },
    });
    return { objectKey: key, allowed: decision.allowed, trace: decision.trace };
  }

  listSources(): readonly SourceDescription[] {
    return this.deps.registry.list().map((plugin) => ({
      source: plugin.manifest.source,
      plugin: plugin.manifest.name,
      version: plugin.manifest.version,
      capabilities: [...plugin.manifest.capabilities],
    }));
  }

  private policyAllows(principal: Principal, object: KnowledgeObject): boolean {
    const sourceDecision = canAccess(principal, object);
    return this.deps.policyEngine.evaluate({ principal, object }, sourceDecision).allowed;
  }
}
