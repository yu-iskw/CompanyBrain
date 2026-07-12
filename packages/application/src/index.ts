import { createHash } from 'node:crypto';

import {
  PluginRequestError,
  type CredentialVault,
  type KnowledgePlugin,
} from '@company-brain/plugin-sdk';

import type {
  AccessExplanation,
  AuditEvent,
  AuditSink,
  KnowledgeObject,
  SearchRequest,
  SearchResponse,
  SourceFailure,
  UserIdentity,
} from '@company-brain/domain';

export type { AuditEvent, AuditSink } from '@company-brain/domain';

export class ConsoleAuditSink implements AuditSink {
  append(event: AuditEvent): Promise<void> {
    process.stderr.write(`${JSON.stringify({ type: 'company-brain.audit', ...event })}\n`);
    return Promise.resolve();
  }
}

export class PluginRegistry {
  readonly #plugins = new Map<string, KnowledgePlugin>();

  register(plugin: KnowledgePlugin): void {
    if (this.#plugins.has(plugin.manifest.id)) {
      throw new Error(`Plugin already registered: ${plugin.manifest.id}`);
    }
    this.#plugins.set(plugin.manifest.id, plugin);
  }

  get(sourceId: string): KnowledgePlugin | undefined {
    return this.#plugins.get(sourceId);
  }

  list(): readonly KnowledgePlugin[] {
    return [...this.#plugins.values()];
  }
}

export class CompanyBrainService {
  constructor(
    private readonly registry: PluginRegistry,
    private readonly credentials: CredentialVault,
    private readonly audit: AuditSink,
  ) {}

  listSources(): readonly { id: string; displayName: string }[] {
    return this.registry.list().map((plugin) => ({
      id: plugin.manifest.id,
      displayName: plugin.manifest.displayName,
    }));
  }

  explainAccess(sourceId: string): AccessExplanation | undefined {
    return this.registry.get(sourceId)?.explainAccess();
  }

  async search(
    request: SearchRequest,
    identity: UserIdentity,
    requestId: string = crypto.randomUUID(),
  ): Promise<SearchResponse> {
    const plugins = this.selectPlugins(request.sourceIds);
    const limit = normalizeLimit(request.limit);
    const perPluginLimit = Math.max(1, Math.ceil(limit / Math.max(1, plugins.length)));
    const outcomes = await Promise.all(
      plugins.map(async (plugin) =>
        this.searchPlugin(plugin, request, identity, requestId, perPluginLimit),
      ),
    );
    const results = outcomes.flatMap((outcome) => outcome.results);
    const failures = outcomes.flatMap((outcome) => outcome.failures);
    const limited = results.slice(0, limit);
    await this.writeSearchAudit(request, identity, requestId, plugins, limited, failures);
    return {
      query: request.query,
      results: limited,
      failures,
      searchedSources: plugins.map((plugin) => plugin.manifest.id),
    };
  }

  async getObject(
    sourceId: string,
    objectId: string,
    identity: UserIdentity,
    requestId: string = crypto.randomUUID(),
  ): Promise<KnowledgeObject | undefined> {
    const plugin = this.registry.get(sourceId);
    if (!plugin) throw new UnknownSourceError(sourceId);
    const token = await this.credentials.get(identity.subject, sourceId);
    if (!token) {
      await this.writeObjectAudit(identity, requestId, sourceId, 'failure', 0);
      throw new SourceNotLinkedError(sourceId);
    }
    let result: KnowledgeObject | undefined;
    try {
      result = await plugin.getObject(objectId, {
        identity,
        accessToken: token,
        requestId,
      });
    } catch (error: unknown) {
      await this.writeObjectAudit(identity, requestId, sourceId, 'failure', 0);
      if (error instanceof PluginRequestError) throw error;
      throw new PluginRequestError('Source object fetch failed', 'unavailable');
    }
    await this.writeObjectAudit(
      identity,
      requestId,
      sourceId,
      result ? 'success' : 'failure',
      result ? 1 : 0,
    );
    return result;
  }

  private selectPlugins(sourceIds?: readonly string[]): readonly KnowledgePlugin[] {
    if (!sourceIds || sourceIds.length === 0) return this.registry.list();
    return sourceIds.map((sourceId) => {
      const plugin = this.registry.get(sourceId);
      if (!plugin) throw new UnknownSourceError(sourceId);
      return plugin;
    });
  }

  private async searchPlugin(
    plugin: KnowledgePlugin,
    request: SearchRequest,
    identity: UserIdentity,
    requestId: string,
    resultLimit: number,
  ): Promise<{ results: readonly KnowledgeObject[]; failures: readonly SourceFailure[] }> {
    const token = await this.credentials.get(identity.subject, plugin.manifest.id);
    if (!token) {
      return {
        results: [],
        failures: [failure(plugin.manifest.id, 'not-linked', 'Source account is not linked')],
      };
    }
    try {
      const results = await plugin.search(request, {
        identity,
        accessToken: token,
        requestId,
        resultLimit,
      });
      return { results, failures: [] };
    } catch (error: unknown) {
      return { results: [], failures: [mapPluginError(plugin.manifest.id, error)] };
    }
  }

  private async writeObjectAudit(
    identity: UserIdentity,
    requestId: string,
    sourceId: string,
    outcome: AuditEvent['outcome'],
    resultCount: number,
  ): Promise<void> {
    await this.audit.append({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      requestId,
      subject: identity.subject,
      action: 'get-object',
      sourceIds: [sourceId],
      outcome,
      resultCount,
    });
  }

  private async writeSearchAudit(
    request: SearchRequest,
    identity: UserIdentity,
    requestId: string,
    plugins: readonly KnowledgePlugin[],
    results: readonly KnowledgeObject[],
    failures: readonly SourceFailure[],
  ): Promise<void> {
    const queryFingerprint = fingerprint(request.query);
    await this.audit.append({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      requestId,
      subject: identity.subject,
      action: 'search',
      sourceIds: plugins.map((plugin) => plugin.manifest.id),
      outcome: failures.length === 0 ? 'success' : results.length > 0 ? 'partial' : 'failure',
      resultCount: results.length,
      queryFingerprint,
    });
  }
}

export class UnknownSourceError extends Error {
  constructor(readonly sourceId: string) {
    super(`Unknown source: ${sourceId}`);
    this.name = 'UnknownSourceError';
  }
}

export class SourceNotLinkedError extends Error {
  constructor(readonly sourceId: string) {
    super(`Source account is not linked: ${sourceId}`);
    this.name = 'SourceNotLinkedError';
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

function failure(sourceId: string, code: SourceFailure['code'], message: string): SourceFailure {
  return { sourceId, code, message };
}

function mapPluginError(sourceId: string, error: unknown): SourceFailure {
  if (error instanceof PluginRequestError) {
    return failure(sourceId, error.code, error.message);
  }
  return failure(sourceId, 'unavailable', 'Source search failed');
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
