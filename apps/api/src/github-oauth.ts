import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';

import type { UserIdentity } from '@company-brain/domain';
import type { OAuthStateStore } from '@company-brain/persistence';
import type { CredentialVault } from '@company-brain/plugin-sdk';

import { redirect } from './auth.js';
import type { GitHubOAuthConfig } from './config.js';

export class GitHubOAuth {
  constructor(
    private readonly config: GitHubOAuthConfig,
    private readonly credentials: CredentialVault,
    private readonly states: OAuthStateStore,
  ) {}

  async begin(identity: UserIdentity, response: ServerResponse): Promise<void> {
    const state = randomBytes(24).toString('base64url');
    await this.states.put(
      state,
      'github',
      { subject: identity.subject },
      new Date(Date.now() + 10 * 60_000),
    );
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: 'repo read:org read:user',
      state,
    }).toString();
    redirect(response, url.toString());
  }

  async finish(code: string, state: string, response: ServerResponse): Promise<void> {
    const pending = await this.states.take(state, 'github');
    if (!pending?.subject) throw new Error('Invalid or expired GitHub OAuth state');
    const token = await exchangeCode(this.config, code);
    await this.credentials.put(pending.subject, 'github', token);
    redirect(response, '/?linked=github');
  }
}

async function exchangeCode(config: GitHubOAuthConfig, code: string): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  const value: unknown = await response.json();
  if (!response.ok || !isTokenResponse(value)) throw new Error('GitHub OAuth code exchange failed');
  return value.access_token;
}

function isTokenResponse(value: unknown): value is { readonly access_token: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'access_token' in value &&
    typeof value.access_token === 'string'
  );
}
