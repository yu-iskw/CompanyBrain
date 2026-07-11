/**
 * HTTP API deployable. Dependency-free (node:http); Cloud Run terminates TLS
 * and the fronting gateway performs OAuth/OIDC. The gateway forwards the
 * verified delegated identity via x-user-id / x-user-groups headers — this
 * service must never be exposed without that authenticating layer.
 */
import { createServer } from 'node:http';

import { isKnowledgeObjectType } from '@companybrain/domain';

import type { SearchService } from '@companybrain/application';
import type { Principal } from '@companybrain/domain';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

function principalFrom(request: IncomingMessage): Principal | undefined {
  const id = request.headers['x-user-id'];
  if (typeof id !== 'string' || id.trim() === '') {
    return undefined;
  }
  const rawGroups = request.headers['x-user-groups'];
  const groups =
    typeof rawGroups === 'string'
      ? rawGroups
          .split(',')
          .map((group) => group.trim())
          .filter((group) => group !== '')
      : [];
  return { id, groups };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw === '') {
    return {};
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function handleSearch(
  service: SearchService,
  principal: Principal,
  body: Record<string, unknown>,
  response: ServerResponse,
): void {
  const entries = new Map(Object.entries(body));
  const query = entries.get('query');
  if (typeof query !== 'string' || query.trim() === '') {
    sendJson(response, 400, { error: '"query" is required' });
    return;
  }
  const source = entries.get('source');
  const type = entries.get('type');
  if (type !== undefined && (typeof type !== 'string' || !isKnowledgeObjectType(type))) {
    sendJson(response, 400, { error: '"type" must be a known knowledge object type' });
    return;
  }
  const limit = entries.get('limit');
  const result = service.search(principal, {
    text: query,
    filters: {
      source: typeof source === 'string' ? source : undefined,
      type: typeof type === 'string' && isKnowledgeObjectType(type) ? type : undefined,
    },
    limit: typeof limit === 'number' ? limit : undefined,
  });
  sendJson(response, 200, {
    auditEventId: result.auditEventId,
    results: result.results.map((entry) => ({
      key: entry.citation.objectKey,
      title: entry.object.title,
      source: entry.object.ref.source,
      type: entry.object.ref.type,
      uri: entry.object.uri,
      score: entry.score,
      citation: entry.citation,
    })),
  });
}

function handleGet(
  service: SearchService,
  principal: Principal,
  url: URL,
  response: ServerResponse,
): void {
  const [, version, collection, ...rest] = url.pathname.split('/');
  const identifier = decodeURIComponent(rest.join('/'));
  if (version !== 'v1' || identifier === '') {
    sendJson(response, 404, { error: 'not found' });
    return;
  }
  switch (collection) {
    case 'objects': {
      const object = service.getObject(principal, identifier);
      if (object === undefined) {
        sendJson(response, 404, { error: `object "${identifier}" not found or not accessible` });
        return;
      }
      sendJson(response, 200, {
        key: identifier,
        title: object.title,
        content: object.content,
        uri: object.uri,
        updatedAt: object.updatedAt,
        metadata: Object.fromEntries(object.metadata),
      });
      return;
    }
    case 'access': {
      sendJson(response, 200, service.explainAccess(principal, identifier));
      return;
    }
    case 'citations': {
      const citation = service.resolveCitation(principal, identifier);
      if (citation === undefined) {
        sendJson(response, 404, { error: `citation "${identifier}" not found or not accessible` });
        return;
      }
      sendJson(response, 200, citation);
      return;
    }
    default: {
      sendJson(response, 404, { error: 'not found' });
    }
  }
}

export function createApiServer(service: SearchService): Server {
  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/healthz') {
        sendJson(response, 200, { status: 'ok' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/sources') {
        sendJson(response, 200, { sources: service.listSources() });
        return;
      }
      const principal = principalFrom(request);
      if (principal === undefined) {
        sendJson(response, 401, { error: 'missing delegated identity (x-user-id header)' });
        return;
      }
      try {
        if (request.method === 'POST' && url.pathname === '/v1/search') {
          handleSearch(service, principal, await readJsonBody(request), response);
          return;
        }
        if (request.method === 'GET') {
          handleGet(service, principal, url, response);
          return;
        }
        sendJson(response, 404, { error: 'not found' });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'bad request' });
      }
    })();
  });
}
