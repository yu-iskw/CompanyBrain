import type { ServerResponse } from 'node:http';

/** Client-facing failures mapped to HTTP 400 by the API. */
export class ClientFacingError extends Error {}

/** Authentication failures mapped to HTTP 401 by the API. */
export class AuthenticationError extends Error {}

/** Upstream identity/provider failures mapped to HTTP 502 by the API. */
export class UpstreamServiceError extends Error {}

export function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location });
  response.end();
}

function isAccessTokenResponse(value: unknown): value is { readonly access_token: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'access_token' in value &&
    typeof value.access_token === 'string'
  );
}

export async function readAccessToken(response: Response, failureMessage: string): Promise<string> {
  const value: unknown = await response.json();
  if (!response.ok || !isAccessTokenResponse(value)) {
    throw new UpstreamServiceError(failureMessage);
  }
  return value.access_token;
}
