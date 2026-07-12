import { createRuntime, seedEnvCredentials } from '@company-brain/runtime';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const runtime = createRuntime();
const identity = { subject: process.env.COMPANY_BRAIN_SUBJECT ?? 'local-mcp-user' };
await seedEnvCredentials(runtime.credentials, identity.subject);

const server = new McpServer({ name: 'company-brain', version: '0.1.0' });

server.registerTool(
  'search',
  {
    title: 'Search company knowledge',
    description: 'Search linked company sources using the requesting user’s delegated permissions.',
    inputSchema: {
      query: z.string().min(2).max(500),
      sourceIds: z.array(z.string()).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ query, sourceIds, limit }) =>
    toolResult(await runtime.service.search({ query, sourceIds, limit }, identity)),
);

async function fetchObject(sourceId: string, objectId: string, missing: string) {
  const object = await runtime.service.getObject(sourceId, objectId, identity);
  return toolResult(object ?? { error: missing });
}

server.registerTool(
  'get_object',
  {
    title: 'Get a knowledge object',
    description: 'Fetch an object live from its source using delegated user permissions.',
    inputSchema: { sourceId: z.string(), objectId: z.string() },
  },
  async ({ sourceId, objectId }) => fetchObject(sourceId, objectId, 'Object not found'),
);

server.registerTool(
  'resolve_citation',
  {
    title: 'Resolve a citation',
    description: 'Resolve a CompanyBrain citation by fetching its current source object.',
    inputSchema: { sourceId: z.string(), objectId: z.string() },
  },
  async ({ sourceId, objectId }) => fetchObject(sourceId, objectId, 'Citation target not found'),
);

server.registerTool(
  'list_sources',
  {
    title: 'List company knowledge sources',
    description: 'List the source plugins available in this CompanyBrain instance.',
    inputSchema: {},
  },
  () => toolResult({ sources: runtime.service.listSources() }),
);

server.registerTool(
  'explain_access',
  {
    title: 'Explain source access',
    description: 'Explain how CompanyBrain enforces authorization for a source.',
    inputSchema: { sourceId: z.string() },
  },
  ({ sourceId }) =>
    toolResult(runtime.service.explainAccess(sourceId) ?? { error: 'Unknown source' }),
);

await server.connect(new StdioServerTransport());

function toolResult(value: unknown): {
  content: [{ type: 'text'; text: string }];
  structuredContent: Record<string, unknown>;
} {
  const structuredContent = isRecord(value) ? value : { value };
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
