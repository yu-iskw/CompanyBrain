import { McpToolSet } from '@companybrain/mcp-adapter';
import { createDemoPlugins, createPlatform } from '@companybrain/testing';
import { beforeAll, describe, expect, it } from 'vitest';

import { handleMessage, principalFromEnv } from './index';

import type { Principal } from '@companybrain/domain';

let tools: McpToolSet;
const alice: Principal = { id: 'alice', groups: ['engineering'] };

beforeAll(async () => {
  const { service } = createPlatform(createDemoPlugins());
  await service.ingestFromCrawlers();
  tools = new McpToolSet(service);
});

describe('principalFromEnv', () => {
  it('reads the delegated identity from the environment', () => {
    expect(
      principalFromEnv({ COMPANYBRAIN_USER_ID: 'alice', COMPANYBRAIN_USER_GROUPS: 'a, b' }),
    ).toEqual({
      id: 'alice',
      groups: ['a', 'b'],
    });
    expect(() => principalFromEnv({})).toThrow(/COMPANYBRAIN_USER_ID/);
  });
});

describe('handleMessage', () => {
  it('answers initialize and swallows the initialized notification', async () => {
    const init = await handleMessage(
      tools,
      alice,
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    );
    expect(init?.result).toMatchObject({ serverInfo: { name: 'companybrain' } });
    const notified = await handleMessage(
      tools,
      alice,
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    );
    expect(notified).toBeUndefined();
  });

  it('lists tools and executes governed calls', async () => {
    const list = await handleMessage(
      tools,
      alice,
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    );
    const listed = (list?.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(listed).toContain('search');
    const call = await handleMessage(
      tools,
      alice,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'travel policy' } },
      }),
    );
    const result = call?.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('google-workspace:document:doc-travel');
  });

  it('rejects malformed JSON and unknown methods', async () => {
    const parseError = await handleMessage(tools, alice, '{nope');
    expect(parseError?.error?.code).toBe(-32700);
    const unknown = await handleMessage(
      tools,
      alice,
      JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'shutdown' }),
    );
    expect(unknown?.error?.code).toBe(-32601);
  });
});
