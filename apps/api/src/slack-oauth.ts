import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';

import type { UserIdentity } from '@company-brain/domain';
import type { OAuthStateStore } from '@company-brain/persistence';
import type { CredentialVault } from '@company-brain/plugin-sdk';

import type { SlackOAuthConfig } from './config.js';
import { redirect } from './auth.js';

export class SlackOAuth {
  constructor(
    private readonly config: SlackOAuthConfig,
    private readonly credentials: CredentialVault,
    private readonly states: OAuthStateStore,
  ) {}

  async begin(identity: UserIdentity, response: ServerResponse): Promise<void> {
    const state = randomBytes(24).toString('base64url');
    await this.states.put(
      state,
      'slack',
      { subject: identity.subject },
      new Date(Date.now() + 10 * 60_000),
    );
    const url = new URL('https://slack.com/oauth/v2/authorize');
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state,
      user_scope: 'search:read,channels:history,groups:history,im:history,mpim:history',
    }).toString();
    redirect(response, url.toString());
  }

  async finish(code: string, state: string, response: ServerResponse): Promise<void> {
    const pending = await this.states.take(state, 'slack');
    if (!pending?.subject) throw new Error('Invalid or expired Slack OAuth state');
    const token = await exchangeCode(this.config, code);
    await this.credentials.put(pending.subject, 'slack', token);
    redirect(response, '/?linked=slack');
  }
}

async function exchangeCode(config: SlackOAuthConfig, code: string): Promise<string> {
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
