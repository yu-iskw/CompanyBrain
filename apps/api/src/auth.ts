import { createHash, randomBytes } from 'node:crypto';

import {
  AuthenticationError,
  ClientFacingError,
  readAccessToken,
  redirect,
  UpstreamServiceError,
} from './http.js';

import type { AppConfig, OidcAuthConfig } from './config.js';
import type { UserIdentity } from '@company-brain/domain';
import type { OAuthStateStore, SessionStore } from '@company-brain/persistence';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface UserInfo {
  readonly sub: string;
  readonly email?: string;
  readonly name?: string;
}

const LOGIN_STATE_COOKIE = 'company_brain_login_state';

export class Authenticator {
  constructor(
    private readonly config: AppConfig,
    private readonly sessions: SessionStore,
    private readonly states: OAuthStateStore,
  ) {}

  async authenticate(request: IncomingMessage): Promise<UserIdentity | undefined> {
    if (this.config.auth.mode === 'local') return { subject: this.config.auth.subject };
    const bearer = readBearer(request.headers.authorization);
    if (bearer) return fetchUserInfo(this.config.auth, bearer);
    const sessionId = readCookies(request.headers.cookie).get('company_brain_session');
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId);
  }

  async beginLogin(response: ServerResponse): Promise<void> {
    if (this.config.auth.mode !== 'oidc') {
      throw new ClientFacingError('OIDC authentication is not configured');
    }
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    await this.states.put(state, 'oidc', { verifier }, new Date(Date.now() + 10 * 60_000));
    const url = new URL(this.config.auth.authorizationUrl);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.auth.clientId,
      redirect_uri: `${this.config.baseUrl}/auth/callback`,
      scope: this.config.auth.scopes,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    response.setHeader(
      'set-cookie',
      `${LOGIN_STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${this.config.production ? '; Secure' : ''}`,
    );
    redirect(response, url.toString());
  }

  async finishLogin(
    request: IncomingMessage,
    code: string,
    state: string,
    response: ServerResponse,
  ): Promise<void> {
    if (this.config.auth.mode !== 'oidc') {
      throw new ClientFacingError('OIDC authentication is not configured');
    }
    const cookieState = readCookies(request.headers.cookie).get(LOGIN_STATE_COOKIE);
    if (!cookieState || cookieState !== state) {
      throw new ClientFacingError('Invalid or mismatched OIDC login state');
    }
    const pending = await this.states.take(state, 'oidc');
    if (!pending?.verifier) throw new ClientFacingError('Invalid or expired OAuth state');
    const accessToken = await exchangeOidcCode(
      this.config,
      this.config.auth,
      code,
      pending.verifier,
    );
    const identity = await fetchUserInfo(this.config.auth, accessToken);
    const sessionId = randomBytes(32).toString('base64url');
    await this.sessions.put(sessionId, identity, new Date(Date.now() + 8 * 60 * 60_000));
    response.setHeader('set-cookie', [
      sessionCookie(sessionId, this.config.production),
      clearCookie(LOGIN_STATE_COOKIE, this.config.production),
    ]);
    redirect(response, '/');
  }
}

function readBearer(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice(7).trim() || undefined;
}

function readCookies(header: string | undefined): Map<string, string> {
  return new Map(
    (header ?? '')
      .split(';')
      .map((part) => part.trim().split('=', 2))
      .filter((pair): pair is [string, string] => pair.length === 2),
  );
}

async function fetchUserInfo(config: OidcAuthConfig, accessToken: string): Promise<UserIdentity> {
  const response = await fetch(config.userInfoUrl, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError('OIDC userinfo rejected the access token');
    }
    throw new UpstreamServiceError('OIDC userinfo request failed');
  }
  const value: unknown = await response.json();
  if (!isUserInfo(value)) throw new UpstreamServiceError('OIDC userinfo response is missing sub');
  return { subject: value.sub, email: value.email, displayName: value.name };
}

function isUserInfo(value: unknown): value is UserInfo {
  return (
    typeof value === 'object' && value !== null && 'sub' in value && typeof value.sub === 'string'
  );
}

async function exchangeOidcCode(
  app: AppConfig,
  oidc: OidcAuthConfig,
  code: string,
  verifier: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: oidc.clientId,
    redirect_uri: `${app.baseUrl}/auth/callback`,
    code_verifier: verifier,
  });
  if (oidc.clientSecret) body.set('client_secret', oidc.clientSecret);
  const response = await fetch(oidc.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  return readAccessToken(response, 'OIDC code exchange failed');
}

function sessionCookie(sessionId: string, production: boolean): string {
  return `company_brain_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${production ? '; Secure' : ''}`;
}

function clearCookie(name: string, production: boolean): string {
  return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${production ? '; Secure' : ''}`;
}
