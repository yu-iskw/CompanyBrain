import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { SourceNotLinkedError, UnknownSourceError } from '@company-brain/application';
import { createRuntime, seedEnvCredentials } from '@company-brain/runtime';

import { Authenticator } from './auth.js';
import { loadConfig } from './config.js';
import {
  ClientFacingError,
  createGitHubOAuth,
  createSlackOAuth,
  type LinkedOAuth,
} from './oauth-helpers.js';
import { createStores } from './stores.js';
import { webPage } from './web.js';

import type { SearchRequest, UserIdentity } from '@company-brain/domain';

const config = loadConfig();
const stores = await createStores(config);
const runtime = createRuntime({ credentials: stores.credentials, audit: stores.audit });
const auth = new Authenticator(config, stores.sessions, stores.oauthStates);
const knownOAuthSources = new Set(['slack', 'github']);
const oauthProviders = new Map<string, LinkedOAuth>();
if (config.slack) {
  oauthProviders.set(
    'slack',
    createSlackOAuth(config.slack, runtime.credentials, stores.oauthStates),
  );
}
if (config.github) {
  oauthProviders.set(
    'github',
    createGitHubOAuth(config.github, runtime.credentials, stores.oauthStates),
  );
}

if (config.auth.mode === 'local') {
  await seedEnvCredentials(runtime.credentials, config.auth.subject);
}

const server = createServer((request, response) => {
  void handleConnection(request, response);
});

server.listen(config.port, () => {
  process.stdout.write(`CompanyBrain listening on ${config.baseUrl}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void stores.close().finally(() => process.exit(0));
    });
  });
}

async function handleConnection(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestId = readRequestId(request);
  const nonce = randomBytes(16).toString('base64url');
  response.setHeader('x-request-id', requestId);
  setSecurityHeaders(response, nonce);
  try {
    await route(request, response, requestId, nonce);
  } catch (error: unknown) {
    handleError(response, error, requestId);
  }
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
  nonce: string,
): Promise<void> {
  const url = new URL(request.url ?? '/', config.baseUrl);
  if (await handlePublicRoutes(request, response, url)) return;

  const identity = await auth.authenticate(request);
  if (!identity) {
    return json(response, 401, { error: 'Authentication required', loginUrl: '/auth/login' });
  }
  if (await handleOAuthRoutes(request, response, url, identity)) return;
  if (await handleApiRoutes(request, response, url, identity, requestId, nonce)) return;
  json(response, 404, { error: 'Not found' });
}

async function handlePublicRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/healthz') {
    json(response, 200, { status: 'ok' });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/auth/login') {
    await auth.beginLogin(response);
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/auth/callback') {
    await auth.finishLogin(
      request,
      requiredParameter(url, 'code'),
      requiredParameter(url, 'state'),
      response,
    );
    return true;
  }
  return false;
}

async function handleOAuthRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  identity: UserIdentity,
): Promise<boolean> {
  if (request.method !== 'GET') return false;
  const match = /^\/oauth\/([^/]+)\/(start|callback)$/.exec(url.pathname);
  if (!match?.[1] || !match[2]) return false;
  const sourceId = match[1];
  const action = match[2];
  if (!knownOAuthSources.has(sourceId)) return false;
  const provider = oauthProviders.get(sourceId);
  if (!provider) {
    json(response, 503, { error: `${sourceId} OAuth is not configured` });
    return true;
  }
  if (action === 'start') {
    await provider.begin(identity, response);
    return true;
  }
  await provider.finish(
    identity,
    requiredParameter(url, 'code'),
    requiredParameter(url, 'state'),
    response,
  );
  return true;
}

async function handleApiRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  identity: UserIdentity,
  requestId: string,
  nonce: string,
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/') {
    html(response, webPage(nonce));
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/sources') {
    await listSources(response, identity);
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/access') {
    const explanation = runtime.service.explainAccess(requiredParameter(url, 'sourceId'));
    if (explanation) json(response, 200, explanation);
    else json(response, 404, { error: 'Unknown source' });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/search') {
    const search = parseSearchRequest(await readJson(request));
    json(response, 200, await runtime.service.search(search, identity, requestId));
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/object') {
    const object = await runtime.service.getObject(
      requiredParameter(url, 'sourceId'),
      requiredParameter(url, 'objectId'),
      identity,
      requestId,
    );
    if (object) json(response, 200, object);
    else json(response, 404, { error: 'Object not found' });
    return true;
  }
  return false;
}

async function listSources(response: ServerResponse, identity: UserIdentity): Promise<void> {
  const sources = await Promise.all(
    runtime.service.listSources().map(async (source) => ({
      ...source,
      linked: Boolean(await runtime.credentials.get(identity.subject, source.id)),
    })),
  );
  json(response, 200, { sources });
}

function parseSearchRequest(value: unknown): SearchRequest {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('query' in value) ||
    typeof value.query !== 'string'
  ) {
    throw new ClientFacingError('query must be a string');
  }
  const query = value.query.trim();
  if (query.length < 2 || query.length > 500) {
    throw new ClientFacingError('query must contain 2–500 characters');
  }
  const sourceIds =
    'sourceIds' in value ? readStringArray(value.sourceIds, 'sourceIds') : undefined;
  const limit = 'limit' in value && typeof value.limit === 'number' ? value.limit : undefined;
  return { query, sourceIds, limit };
}

function readStringArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new ClientFacingError(`${name} must be an array of strings`);
  }
  return value;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const part = typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk);
    size += part.byteLength;
    if (size > 64 * 1024) throw new ClientFacingError('Request body is too large');
    chunks.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ClientFacingError('Request body must be valid JSON');
  }
}

function requiredParameter(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) throw new ClientFacingError(`Missing ${name}`);
  return value;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function html(response: ServerResponse, value: string): void {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(value);
}

function setSecurityHeaders(response: ServerResponse, nonce: string): void {
  response.setHeader(
    'content-security-policy',
    `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'`,
  );
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
}

function readRequestId(request: IncomingMessage): string {
  const value = request.headers['x-request-id'];
  return typeof value === 'string' && /^[\w-]{1,128}$/.test(value) ? value : crypto.randomUUID();
}

function handleError(response: ServerResponse, error: unknown, requestId: string): void {
  if (error instanceof ClientFacingError)
    return json(response, 400, { error: error.message, requestId });
  if (error instanceof UnknownSourceError)
    return json(response, 404, { error: error.message, requestId });
  if (error instanceof SourceNotLinkedError)
    return json(response, 409, { error: 'Source account is not linked', requestId });
  process.stderr.write(
    `${JSON.stringify({ type: 'company-brain.error', requestId, message: safeMessage(error) })}\n`,
  );
  json(response, 500, { error: 'Internal server error', requestId });
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
