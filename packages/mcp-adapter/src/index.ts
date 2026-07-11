/**
 * MCP adapter: exposes the governed application services as MCP tools.
 * Phase 1 tools: search, get_object, resolve_citation, list_sources,
 * explain_access. Transport (stdio/HTTP) lives in apps/mcp-server; this
 * package is transport-agnostic.
 */
import { isKnowledgeObjectType, knowledgeObjectKey } from '@companybrain/domain';

import type { SearchService } from '@companybrain/application';
import type { Principal } from '@companybrain/domain';

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the tool input. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface McpToolResult {
  readonly isError: boolean;
  readonly content: unknown;
}

type ToolHandler = (principal: Principal, args: Record<string, unknown>) => Promise<McpToolResult>;

function ok(content: unknown): McpToolResult {
  return { isError: false, content };
}

function err(message: string): McpToolResult {
  return { isError: true, content: { error: message } };
}

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = new Map(Object.entries(args)).get(name);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export class McpToolSet {
  private readonly service: SearchService;
  private readonly handlers = new Map<
    string,
    { definition: McpToolDefinition; handle: ToolHandler }
  >();

  constructor(service: SearchService) {
    this.service = service;
    this.registerSearch();
    this.registerGetObject();
    this.registerResolveCitation();
    this.registerListSources();
    this.registerExplainAccess();
  }

  listTools(): readonly McpToolDefinition[] {
    return [...this.handlers.values()].map((entry) => entry.definition);
  }

  async callTool(
    principal: Principal,
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const entry = this.handlers.get(name);
    if (entry === undefined) {
      return err(`unknown tool "${name}"`);
    }
    return entry.handle(principal, args);
  }

  private register(definition: McpToolDefinition, handle: ToolHandler): void {
    this.handlers.set(definition.name, { definition, handle });
  }

  private registerSearch(): void {
    this.register(
      {
        name: 'search',
        description:
          'Governed hybrid search across all federated sources. Results are permission-filtered for the calling user and include citations.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query text' },
            source: { type: 'string', description: 'Optional source system filter' },
            type: { type: 'string', description: 'Optional knowledge object type filter' },
            limit: { type: 'number', description: 'Maximum results (default 10)' },
          },
          required: ['query'],
        },
      },
      (principal, args) => {
        const query = stringArg(args, 'query');
        if (query === undefined) {
          return Promise.resolve(err('"query" is required'));
        }
        const type = stringArg(args, 'type');
        if (type !== undefined && !isKnowledgeObjectType(type)) {
          return Promise.resolve(err(`unknown object type "${type}"`));
        }
        const rawLimit = new Map(Object.entries(args)).get('limit');
        const response = this.service.search(principal, {
          text: query,
          filters: {
            source: stringArg(args, 'source'),
            type: type !== undefined && isKnowledgeObjectType(type) ? type : undefined,
          },
          limit: typeof rawLimit === 'number' ? rawLimit : undefined,
        });
        return Promise.resolve(
          ok({
            results: response.results.map((result) => ({
              key: knowledgeObjectKey(result.object.ref),
              title: result.object.title,
              type: result.object.ref.type,
              source: result.object.ref.source,
              uri: result.object.uri,
              score: result.score,
              citation: result.citation,
            })),
            auditEventId: response.auditEventId,
          }),
        );
      },
    );
  }

  private registerGetObject(): void {
    this.register(
      {
        name: 'get_object',
        description: 'Fetch a single knowledge object by key, subject to source ACLs and policy.',
        inputSchema: {
          type: 'object',
          properties: { key: { type: 'string', description: 'Object key (source:type:id)' } },
          required: ['key'],
        },
      },
      (principal, args) => {
        const key = stringArg(args, 'key');
        if (key === undefined) {
          return Promise.resolve(err('"key" is required'));
        }
        const object = this.service.getObject(principal, key);
        if (object === undefined) {
          return Promise.resolve(err(`object "${key}" not found or not accessible`));
        }
        return Promise.resolve(
          ok({
            key,
            title: object.title,
            content: object.content,
            uri: object.uri,
            updatedAt: object.updatedAt,
            metadata: Object.fromEntries(object.metadata),
          }),
        );
      },
    );
  }

  private registerResolveCitation(): void {
    this.register(
      {
        name: 'resolve_citation',
        description: 'Resolve a citation id from a previous search back to its source object.',
        inputSchema: {
          type: 'object',
          properties: { citation_id: { type: 'string', description: 'Citation id' } },
          required: ['citation_id'],
        },
      },
      (principal, args) => {
        const citationId = stringArg(args, 'citation_id');
        if (citationId === undefined) {
          return Promise.resolve(err('"citation_id" is required'));
        }
        const citation = this.service.resolveCitation(principal, citationId);
        return Promise.resolve(
          citation === undefined
            ? err(`citation "${citationId}" not found or no longer accessible`)
            : ok(citation),
        );
      },
    );
  }

  private registerListSources(): void {
    this.register(
      {
        name: 'list_sources',
        description: 'List federated source systems and their plugin capabilities.',
        inputSchema: { type: 'object', properties: {} },
      },
      () => Promise.resolve(ok({ sources: this.service.listSources() })),
    );
  }

  private registerExplainAccess(): void {
    this.register(
      {
        name: 'explain_access',
        description:
          'Explain why the calling user can or cannot access a knowledge object (source ACL + policy trace).',
        inputSchema: {
          type: 'object',
          properties: { key: { type: 'string', description: 'Object key (source:type:id)' } },
          required: ['key'],
        },
      },
      (principal, args) => {
        const key = stringArg(args, 'key');
        if (key === undefined) {
          return Promise.resolve(err('"key" is required'));
        }
        return Promise.resolve(ok(this.service.explainAccess(principal, key)));
      },
    );
  }
}
