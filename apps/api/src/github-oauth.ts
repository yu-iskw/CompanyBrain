import type { ServerResponse } from 'node:http';

import type { UserIdentity } from '@company-brain/domain';
import type { OAuthStateStore } from '@company-brain/persistence';
import type { CredentialVault } from '@company-brain/plugin-sdk';

import type { OAuthClientConfig } from './config.js';
import {
  beginLinkedOAuth,
  finishLinkedOAuth,
  isAccessTokenResponse,
} from './oauth-helpers.js';

export class GitHubOAuth {
  constructor(
    private readonly config: OAuthClientConfig,
    private readonly credentials: CredentialVault,
    private readonly states: OAuthStateStore,
  ) {}

  async begin(identity: UserIdentity, response: ServerResponse): Promise<void> {
    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: 'repo read:org read:user',
    }).toString();
    await beginLinkedOAuth({
      states: this.states,
      flow: 'github',
      identity,
      authorizeUrl,
      response,
    });
  }

  async finish(
    identity: UserIdentity,
    code: string,
    state: string,
    response: ServerResponse,
  ): Promise<void> {
    await finishLinkedOAuth({
      states: this.states,
      credentials: this.credentials,
      identity,
      flow: 'github',
      sourceId: 'github',
      code,
      state,
      exchange: (oauthCode) => exchangeCode(this.config, oauthCode),
      response,
    });
  }
}

async function exchangeCode(config: OAuthClientConfig, code: string): Promise<string> {
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
  if (!response.ok || !isAccessTokenResponse(value)) throw new Error('GitHub OAuth code exchange failed');
  return value.access_token;
}
