import { randomBytes } from 'node:crypto';

import { ClientFacingError, isAccessTokenResponse, redirect } from './http.js';

import type { OAuthClientConfig } from './config.js';
import type { UserIdentity } from '@company-brain/domain';
import type { OAuthStateStore } from '@company-brain/persistence';
import type { CredentialVault } from '@company-brain/plugin-sdk';
import type { ServerResponse } from 'node:http';

class LinkedOAuth {
  constructor(
    readonly sourceId: string,
    private readonly config: OAuthClientConfig,
    private readonly credentials: CredentialVault,
    private readonly states: OAuthStateStore,
    private readonly buildAuthorizeUrl: (config: OAuthClientConfig) => URL,
    private readonly exchange: (config: OAuthClientConfig, code: string) => Promise<string>,
  ) {}

  async begin(identity: UserIdentity, response: ServerResponse): Promise<void> {
    const state = randomBytes(24).toString('base64url');
    await this.states.put(
      state,
      this.sourceId,
      { subject: identity.subject },
      new Date(Date.now() + 10 * 60_000),
    );
    const authorizeUrl = this.buildAuthorizeUrl(this.config);
    authorizeUrl.searchParams.set('state', state);
    redirect(response, authorizeUrl.toString());
  }

  async finish(
    identity: UserIdentity,
    code: string,
    state: string,
    response: ServerResponse,
  ): Promise<void> {
    const pending = await this.states.take(state, this.sourceId);
    if (!pending?.subject) {
      throw new ClientFacingError(`Invalid or expired ${this.sourceId} OAuth state`);
    }
    if (pending.subject !== identity.subject) {
      throw new ClientFacingError('OAuth state does not match the authenticated user');
    }
    const token = await this.exchange(this.config, code);
    await this.credentials.put(identity.subject, this.sourceId, token);
    redirect(response, `/?linked=${this.sourceId}`);
  }
}

interface OAuthProviderDefinition {
  readonly id: string;
  readonly config?: OAuthClientConfig;
  readonly buildAuthorizeUrl: (config: OAuthClientConfig) => URL;
  readonly exchange: (config: OAuthClientConfig, code: string) => Promise<string>;
}

export function buildOAuthProviders(
  definitions: readonly OAuthProviderDefinition[],
  credentials: CredentialVault,
  states: OAuthStateStore,
): {
  readonly knownSources: ReadonlySet<string>;
  readonly providers: ReadonlyMap<string, LinkedOAuth>;
} {
  const knownSources = new Set(definitions.map((definition) => definition.id));
  const providers = new Map<string, LinkedOAuth>();
  for (const definition of definitions) {
    if (!definition.config) continue;
    providers.set(
      definition.id,
      new LinkedOAuth(
        definition.id,
        definition.config,
        credentials,
        states,
        definition.buildAuthorizeUrl,
        definition.exchange,
      ),
    );
  }
  return { knownSources, providers };
}

export function slackAuthorizeUrl(config: OAuthClientConfig): URL {
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    user_scope: 'search:read,channels:history,groups:history,im:history,mpim:history',
  }).toString();
  return url;
}

export function githubAuthorizeUrl(config: OAuthClientConfig): URL {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'repo read:org read:user',
  }).toString();
  return url;
}

export async function exchangeGitHubCode(config: OAuthClientConfig, code: string): Promise<string> {
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
  if (!response.ok || !isAccessTokenResponse(value)) {
    throw new ClientFacingError('GitHub OAuth code exchange failed');
  }
  return value.access_token;
}

export async function exchangeSlackCode(config: OAuthClientConfig, code: string): Promise<string> {
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
    throw new ClientFacingError(
      'Slack OAuth code exchange failed or did not return a delegated user token',
    );
  }
  return value.authed_user.access_token;
}

function isSlackTokenResponse(
  value: unknown,
): value is { readonly ok: true; readonly authed_user: { readonly access_token: string } } {
  if (typeof value !== 'object' || value === null || !('ok' in value) || value.ok !== true) {
    return false;
  }
  if (
    !('authed_user' in value) ||
    typeof value.authed_user !== 'object' ||
    value.authed_user === null
  ) {
    return false;
  }
  return 'access_token' in value.authed_user && typeof value.authed_user.access_token === 'string';
}
