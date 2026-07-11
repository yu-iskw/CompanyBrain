import type { ServerResponse } from 'node:http';

import type { UserIdentity } from '@company-brain/domain';
import type { OAuthStateStore } from '@company-brain/persistence';
import type { CredentialVault } from '@company-brain/plugin-sdk';

import type { OAuthClientConfig } from './config.js';
import { beginLinkedOAuth, finishLinkedOAuth } from './oauth-helpers.js';

export class SlackOAuth {
  constructor(
    private readonly config: OAuthClientConfig,
    private readonly credentials: CredentialVault,
    private readonly states: OAuthStateStore,
  ) {}

  async begin(identity: UserIdentity, response: ServerResponse): Promise<void> {
    const authorizeUrl = new URL('https://slack.com/oauth/v2/authorize');
    authorizeUrl.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      user_scope: 'search:read,channels:history,groups:history,im:history,mpim:history',
    }).toString();
    await beginLinkedOAuth({
      states: this.states,
      flow: 'slack',
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
      flow: 'slack',
      sourceId: 'slack',
      code,
      state,
      exchange: (oauthCode) => exchangeCode(this.config, oauthCode),
      response,
    });
  }
}

async function exchangeCode(config: OAuthClientConfig, code: string): Promise<string> {
  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ code, redirect_uri: config.redirectUri }),
  });
  const value: unknown = await response.json();
  if (!response.ok || !isSlackTokenResponse(value)) {
    throw new Error('Slack OAuth code exchange failed or did not return a delegated user token');
  }
  return value.authed_user.access_token;
}

function isSlackTokenResponse(
  value: unknown,
): value is { readonly ok: true; readonly authed_user: { readonly access_token: string } } {
  if (typeof value !== 'object' || value === null || !('ok' in value) || value.ok !== true)
    return false;
  if (
    !('authed_user' in value) ||
    typeof value.authed_user !== 'object' ||
    value.authed_user === null
  ) {
    return false;
  }
  return 'access_token' in value.authed_user && typeof value.authed_user.access_token === 'string';
}
