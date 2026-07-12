import { describe, expect, it, vi } from 'vitest';

import { GitHubPlugin } from './index.js';

const context = {
  identity: { subject: 'alice' },
  accessToken: 'github-token',
  requestId: 'request',
  resultLimit: 20,
};

describe('GitHubPlugin', () => {
  it('searches code and issues with the delegated token', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                name: 'policy.ts',
                path: 'src/policy.ts',
                html_url: 'https://github.com/acme/brain/blob/main/src/policy.ts',
                repository: { full_name: 'acme/brain', html_url: 'https://github.com/acme/brain' },
                text_matches: [{ fragment: 'export const policy = true' }],
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                number: 12,
                title: 'Policy issue',
                body: 'Review access policy',
                html_url: 'https://github.com/acme/brain/issues/12',
                repository_url: 'https://api.github.com/repos/acme/brain',
                user: { login: 'octocat' },
              },
            ],
          }),
        ),
      );

    const results = await new GitHubPlugin(request).search({ query: 'policy' }, context);

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.type)).toEqual(['file', 'issue']);
    const init = request.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer github-token');
  });

  it('resolves a file citation without accepting an arbitrary URL', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                name: 'README.md',
                path: 'README.md',
                html_url: 'https://github.com/acme/brain/blob/main/README.md',
                repository: { full_name: 'acme/brain', html_url: 'https://github.com/acme/brain' },
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            encoding: 'base64',
            content: Buffer.from('# CompanyBrain').toString('base64'),
            path: 'README.md',
            html_url: 'https://github.com/acme/brain/blob/main/README.md',
          }),
        ),
      );
    const plugin = new GitHubPlugin(request);
    const result = (await plugin.search({ query: 'readme', limit: 2 }, context))[0];

    const resolved = await plugin.getObject(result?.citation.objectId ?? '', context);

    expect(resolved?.excerpt).toBe('# CompanyBrain');
    expect(request.mock.calls[2]?.[0]).toBe(
      'https://api.github.com/repos/acme/brain/contents/README.md',
    );
    await expect(plugin.getObject('invalid', context)).rejects.toThrow('Invalid GitHub object ID');
  });

  it('surfaces GitHub permission failures', async () => {
    const plugin = new GitHubPlugin(
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 })),
    );
    await expect(plugin.search({ query: 'policy' }, context)).rejects.toThrow('GitHub HTTP 403');
  });

  it('returns undefined when a live GitHub object is missing', async () => {
    const objectId = Buffer.from(
      JSON.stringify({ kind: 'code', owner: 'acme', repository: 'brain', path: 'gone.ts' }),
    ).toString('base64url');
    const plugin = new GitHubPlugin(
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 })),
    );
    await expect(plugin.getObject(objectId, context)).resolves.toBeUndefined();
  });
});
