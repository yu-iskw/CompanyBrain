import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';

import type { UserIdentity } from '@company-brain/domain';
import type { OAuthStateStore } from '@company-brain/persistence';
import type { CredentialVault } from '@company-brain/plugin-sdk';

import { redirect } from './auth.js';

/** Client-facing OAuth/auth failures mapped to HTTP 400 by the API. */
export class ClientFacingError extends Error {}

export function isAccessTokenResponse(value: unknown): value is { readonly access_token: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'access_token' in value &&
    typeof value.access_token === 'string'
  );
}

export async function beginLinkedOAuth(options: {
  readonly states: OAuthStateStore;
  readonly flow: string;
  readonly identity: UserIdentity;
  readonly authorizeUrl: URL;
  readonly response: ServerResponse;
}): Promise<void> {
  const state = randomBytes(24).toString('base64url');
  await options.states.put(
    state,
    options.flow,
    { subject: options.identity.subject },
    new Date(Date.now() + 10 * 60_000),
  );
  options.authorizeUrl.searchParams.set('state', state);
  redirect(options.response, options.authorizeUrl.toString());
}

export async function finishLinkedOAuth(options: {
  readonly states: OAuthStateStore;
  readonly credentials: CredentialVault;
  readonly identity: UserIdentity;
  readonly flow: string;
  readonly sourceId: string;
  readonly code: string;
  readonly state: string;
  readonly exchange: (code: string) => Promise<string>;
  readonly response: ServerResponse;
}): Promise<void> {
  const pending = await options.states.take(options.state, options.flow);
  if (!pending?.subject) {
    throw new ClientFacingError(`Invalid or expired ${options.sourceId} OAuth state`);
  }
  if (pending.subject !== options.identity.subject) {
    throw new ClientFacingError('OAuth state does not match the authenticated user');
  }
  const token = await options.exchange(options.code);
  await options.credentials.put(options.identity.subject, options.sourceId, token);
  redirect(options.response, `/?linked=${options.sourceId}`);
}
