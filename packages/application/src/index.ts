import type {
  AccessExplanation,
  KnowledgeObject,
  SearchRequest,
  SearchResponse,
  SourceFailure,
  UserIdentity,
} from '@company-brain/domain';
import type { CredentialVault, KnowledgePlugin } from '@company-brain/plugin-sdk';

export interface AuditEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly requestId: string;
  readonly subject: string;
  readonly action: 'search' | 'get-object';
  readonly sourceIds: readonly string[];
  readonly outcome: 'success' | 'partial' | 'failure';
  readonly resultCount: number;
  readonly queryFingerprint?: string;
}

export interface AuditSink {
  append(event: AuditEvent): Promise<void>;
}

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
    const outcomes = await Promise.all(
      plugins.map(async (plugin) => this.searchPlugin(plugin, request, identity, requestId)),
    );
    const results = outcomes.flatMap((outcome) => outcome.results);
    const failures = outcomes.flatMap((outcome) => outcome.failures);
    const limited = results.slice(0, normalizeLimit(request.limit));
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
    if (!token) throw new SourceNotLinkedError(sourceId);
    const result = await plugin.getObject(objectId, { identity, accessToken: token, requestId });
    await this.audit.append({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      requestId,
      subject: identity.subject,
      action: 'get-object',
      sourceIds: [sourceId],
      outcome: result ? 'success' : 'failure',
      resultCount: result ? 1 : 0,
    });
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
  ): Promise<{ results: readonly KnowledgeObject[]; failures: readonly SourceFailure[] }> {
    const token = await this.credentials.get(identity.subject, plugin.manifest.id);
    if (!token) {
      return {
        results: [],
        failures: [failure(plugin.manifest.id, 'not-linked', 'Source account is not linked')],
      };
    }
    try {
      const results = await plugin.search(request, { identity, accessToken: token, requestId });
      return { results, failures: [] };
    } catch (error: unknown) {
      return { results: [], failures: [mapPluginError(plugin.manifest.id, error)] };
    }
  }

  private async writeSearchAudit(
    request: SearchRequest,
    identity: UserIdentity,
    requestId: string,
    plugins: readonly KnowledgePlugin[],
    results: readonly KnowledgeObject[],
    failures: readonly SourceFailure[],
  ): Promise<void> {
    const queryFingerprint = await fingerprint(request.query);
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

export class UnknownSourceError extends Error {}
export class SourceNotLinkedError extends Error {}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return 20;
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

function failure(sourceId: string, code: SourceFailure['code'], message: string): SourceFailure {
  return { sourceId, code, message };
}

function mapPluginError(sourceId: string, error: unknown): SourceFailure {
  const message = error instanceof Error ? error.message : 'Source search failed';
  if (/rate.?limit|429/i.test(message)) return failure(sourceId, 'rate-limited', message);
  if (/forbidden|not_allowed|missing_scope|403/i.test(message))
    return failure(sourceId, 'forbidden', message);
  return failure(sourceId, 'unavailable', message);
}

async function fingerprint(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Buffer.from(digest).toString('hex');
}
