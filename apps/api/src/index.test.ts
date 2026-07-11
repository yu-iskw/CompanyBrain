import { createDemoPlugins, createPlatform } from '@companybrain/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiServer } from './index';

import type { Server } from 'node:http';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { service } = createPlatform(createDemoPlugins());
  await service.ingestFromCrawlers();
  server = createApiServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected an ephemeral port');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const aliceHeaders = { 'x-user-id': 'alice', 'x-user-groups': 'engineering' };

describe('api server', () => {
  it('serves health and sources without identity', async () => {
    const health = await fetch(`${baseUrl}/healthz`);
    expect(health.status).toBe(200);
    const sources = (await (await fetch(`${baseUrl}/v1/sources`)).json()) as {
      sources: Array<{ source: string }>;
    };
    expect(sources.sources.map((s) => s.source).sort((a, b) => a.localeCompare(b))).toEqual([
      'bigquery',
      'github',
      'google-workspace',
      'notion',
      'slack',
    ]);
  });

  it('requires delegated identity for search', async () => {
    const response = await fetch(`${baseUrl}/v1/search`, {
      method: 'POST',
      body: JSON.stringify({ query: 'onboarding' }),
    });
    expect(response.status).toBe(401);
  });

  it('searches with permission filtering and citations', async () => {
    const response = await fetch(`${baseUrl}/v1/search`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({ query: 'onboarding checklist' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{ key: string; citation: { id: string } }>;
      auditEventId: string;
    };
    expect(body.results[0].key).toBe('notion:document:page-onboarding');
    expect(body.auditEventId.length).toBeGreaterThan(0);

    const citation = await fetch(`${baseUrl}/v1/citations/${body.results[0].citation.id}`, {
      headers: aliceHeaders,
    });
    expect(citation.status).toBe(200);
  });

  it('validates search input', async () => {
    const missing = await fetch(`${baseUrl}/v1/search`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
    const badType = await fetch(`${baseUrl}/v1/search`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({ query: 'x', type: 'spreadsheet' }),
    });
    expect(badType.status).toBe(400);
    const badJson = await fetch(`${baseUrl}/v1/search`, {
      method: 'POST',
      headers: aliceHeaders,
      body: 'not json',
    });
    expect(badJson.status).toBe(400);
  });

  it('serves objects subject to source ACLs', async () => {
    const open = await fetch(
      `${baseUrl}/v1/objects/${encodeURIComponent('notion:document:page-onboarding')}`,
      {
        headers: aliceHeaders,
      },
    );
    expect(open.status).toBe(200);
    const restricted = await fetch(
      `${baseUrl}/v1/objects/${encodeURIComponent('github:pull-request:acme/secrets#7')}`,
      { headers: { 'x-user-id': 'mallory' } },
    );
    expect(restricted.status).toBe(404);
    const allowed = await fetch(
      `${baseUrl}/v1/objects/${encodeURIComponent('github:pull-request:acme/secrets#7')}`,
      { headers: { 'x-user-id': 'alice' } },
    );
    expect(allowed.status).toBe(200);
  });

  it('explains access decisions', async () => {
    const response = await fetch(
      `${baseUrl}/v1/access/${encodeURIComponent('github:pull-request:acme/secrets#7')}`,
      { headers: { 'x-user-id': 'mallory' } },
    );
    const body = (await response.json()) as { allowed: boolean; trace: string[] };
    expect(body.allowed).toBe(false);
    expect(body.trace.length).toBeGreaterThan(0);
  });

  it('returns 404 for unknown routes', async () => {
    expect((await fetch(`${baseUrl}/v1/nope/x`, { headers: aliceHeaders })).status).toBe(404);
    expect((await fetch(`${baseUrl}/nope`, { headers: aliceHeaders })).status).toBe(404);
  });
});
