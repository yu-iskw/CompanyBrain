import { describe, expect, it, vi } from 'vitest';

import { SlackPlugin } from './index.js';

describe('SlackPlugin', () => {
  it('searches with a delegated token and maps provenance', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          messages: {
            matches: [
              {
                channel_id: 'C123',
                channel_name: 'engineering',
                permalink: 'https://example.slack.com/archives/C123/p1700000000000000',
                text: 'See <https://example.com|the design>',
                ts: '1700000000.000000',
                username: 'Ada',
              },
            ],
          },
        }),
      ),
    );
    const plugin = new SlackPlugin(request);

    const results = await plugin.search(
      { query: 'design' },
      {
        identity: { subject: 'user-1' },
        accessToken: 'xoxp-secret',
        requestId: 'request-1',
        resultLimit: 20,
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sourceId: 'slack',
      excerpt: 'See the design',
      author: 'Ada',
      citation: { sourceId: 'slack' },
    });
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('search.messages'),
      expect.objectContaining({ headers: { authorization: 'Bearer xoxp-secret' } }),
    );
  });

  it('does not expose a Slack API failure as an empty success', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'missing_scope' })));
    const plugin = new SlackPlugin(request);

    await expect(
      plugin.search(
        { query: 'design' },
        {
          identity: { subject: 'user-1' },
          accessToken: 'token',
          requestId: 'request-1',
          resultLimit: 20,
        },
      ),
    ).rejects.toThrow('missing_scope');
  });

  it('retrieves an object by its opaque object ID', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            messages: { matches: [{ channel_id: 'C123', text: 'Result', ts: '1700000000.1' }] },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, messages: [{ text: 'Live result', ts: '1700000000.1' }] }),
        ),
      );
    const plugin = new SlackPlugin(request);
    const context = {
      identity: { subject: 'user' },
      accessToken: 'token',
      requestId: 'request',
      resultLimit: 20,
    };
    const result = (await plugin.search({ query: 'result' }, context))[0];

    const object = await plugin.getObject(result?.citation.objectId ?? '', context);

    expect(object?.excerpt).toBe('Live result');
    expect(request.mock.calls[1]?.[0]).toContain('conversations.history');
  });

  it('returns undefined when a live object no longer exists', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, messages: [] })));
    const plugin = new SlackPlugin(request);
    const objectId = Buffer.from(JSON.stringify({ channelId: 'C1', timestamp: '1.0' })).toString(
      'base64url',
    );

    await expect(
      plugin.getObject(objectId, {
        identity: { subject: 'u' },
        accessToken: 't',
        requestId: 'r',
        resultLimit: 20,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects malformed object IDs and transport responses', async () => {
    const plugin = new SlackPlugin();
    await expect(
      plugin.getObject('invalid', {
        identity: { subject: 'u' },
        accessToken: 't',
        requestId: 'r',
        resultLimit: 20,
      }),
    ).rejects.toThrow('Invalid Slack object ID');

    const httpFailure = new SlackPlugin(
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 })),
    );
    await expect(
      httpFailure.search(
        { query: 'x' },
        { identity: { subject: 'u' }, accessToken: 't', requestId: 'r', resultLimit: 20 },
      ),
    ).rejects.toThrow('Slack HTTP 503');

    const invalidPayload = new SlackPlugin(
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}')),
    );
    await expect(
      invalidPayload.search(
        { query: 'x' },
        { identity: { subject: 'u' }, accessToken: 't', requestId: 'r', resultLimit: 20 },
      ),
    ).rejects.toThrow('invalid response');
  });
});
