import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { SourceNotLinkedError, UnknownSourceError } from '@company-brain/application';
import type { SearchRequest, UserIdentity } from '@company-brain/domain';
import { createRuntime, seedEnvCredentials } from '@company-brain/runtime';

import { Authenticator } from './auth.js';
import { loadConfig } from './config.js';
import { GitHubOAuth } from './github-oauth.js';
import { ClientFacingError } from './oauth-helpers.js';
import { SlackOAuth } from './slack-oauth.js';
import { createStores } from './stores.js';
import { webPage } from './web.js';

const config = loadConfig();
const stores = await createStores(config);
const runtime = createRuntime({ credentials: stores.credentials, audit: stores.audit });
const auth = new Authenticator(config, stores.sessions, stores.oauthStates);
const slackOAuth = config.slack
  ? new SlackOAuth(config.slack, runtime.credentials, stores.oauthStates)
  : undefined;
const githubOAuth = config.github
  ? new GitHubOAuth(config.github, runtime.credentials, stores.oauthStates)
  : undefined;

if (config.auth.mode === 'local') {
  await seedEnvCredentials(runtime.credentials, config.auth.subject);
}

const server = createServer(async (request, response) => {
  const requestId = readRequestId(request);
  const nonce = randomBytes(16).toString('base64url');
  response.setHeader('x-request-id', requestId);
  setSecurityHeaders(response, nonce);
  try {
    await route(request, response, requestId, nonce);
  } catch (error: unknown) {
    handleError(response, error, requestId);
  }
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

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
  nonce: string,
): Promise<void> {
  const url = new URL(request.url ?? '/', config.baseUrl);
  if (request.method === 'GET' && url.pathname === '/healthz')
    return json(response, 200, { status: 'ok' });
  if (request.method === 'GET' && url.pathname === '/auth/login') return auth.beginLogin(response);
  if (request.method === 'GET' && url.pathname === '/auth/callback') {
    return auth.finishLogin(
      request,
      requiredParameter(url, 'code'),
      requiredParameter(url, 'state'),
      response,
    );
  }

  const identity = await auth.authenticate(request);
  if (!identity)
    return json(response, 401, { error: 'Authentication required', loginUrl: '/auth/login' });
  if (request.method === 'GET' && url.pathname === '/') return html(response, webPage(nonce));
  if (request.method === 'GET' && url.pathname === '/oauth/slack/start') {
    if (!slackOAuth) return json(response, 503, { error: 'Slack OAuth is not configured' });
    return slackOAuth.begin(identity, response);
  }
  if (request.method === 'GET' && url.pathname === '/oauth/slack/callback') {
    if (!slackOAuth) return json(response, 503, { error: 'Slack OAuth is not configured' });
    return slackOAuth.finish(
      identity,
      requiredParameter(url, 'code'),
      requiredParameter(url, 'state'),
      response,
    );
  }
  if (request.method === 'GET' && url.pathname === '/oauth/github/start') {
    if (!githubOAuth) return json(response, 503, { error: 'GitHub OAuth is not configured' });
    return githubOAuth.begin(identity, response);
  }
  if (request.method === 'GET' && url.pathname === '/oauth/github/callback') {
    if (!githubOAuth) return json(response, 503, { error: 'GitHub OAuth is not configured' });
    return githubOAuth.finish(
      identity,
      requiredParameter(url, 'code'),
      requiredParameter(url, 'state'),
      response,
    );
  }
  if (request.method === 'GET' && url.pathname === '/api/sources') {
    return listSources(response, identity);
  }
  if (request.method === 'GET' && url.pathname === '/api/access') {
    const sourceId = requiredParameter(url, 'sourceId');
    const explanation = runtime.service.explainAccess(sourceId);
    return explanation
      ? json(response, 200, explanation)
      : json(response, 404, { error: 'Unknown source' });
  }
  if (request.method === 'POST' && url.pathname === '/api/search') {
    const search = parseSearchRequest(await readJson(request));
    return json(response, 200, await runtime.service.search(search, identity, requestId));
  }
  if (request.method === 'GET' && url.pathname === '/api/object') {
    const object = await runtime.service.getObject(
      requiredParameter(url, 'sourceId'),
      requiredParameter(url, 'objectId'),
      identity,
      requestId,
    );
    return object
      ? json(response, 200, object)
      : json(response, 404, { error: 'Object not found' });
  }
  json(response, 404, { error: 'Not found' });
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
    throw new BadRequestError('query must be a string');
  }
  const query = value.query.trim();
  if (query.length < 2 || query.length > 500)
    throw new BadRequestError('query must contain 2–500 characters');
  const sourceIds =
    'sourceIds' in value ? readStringArray(value.sourceIds, 'sourceIds') : undefined;
  const limit = 'limit' in value && typeof value.limit === 'number' ? value.limit : undefined;
  return { query, sourceIds, limit };
}

function readStringArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new BadRequestError(`${name} must be an array of strings`);
  }
  return value;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new BadRequestError('Request body is too large');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BadRequestError('Request body must be valid JSON');
  }
}

function requiredParameter(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) throw new BadRequestError(`Missing ${name}`);
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
  if (error instanceof BadRequestError || error instanceof ClientFacingError)
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

class BadRequestError extends Error {}
