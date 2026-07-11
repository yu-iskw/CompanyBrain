import type { ServerResponse } from 'node:http';

/** Client-facing failures mapped to HTTP 400 by the API. */
export class ClientFacingError extends Error {}

/** Authentication failures mapped to HTTP 401 by the API. */
export class AuthenticationError extends Error {}

export function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location });
  response.end();
}

export function isAccessTokenResponse(value: unknown): value is { readonly access_token: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'access_token' in value &&
    typeof value.access_token === 'string'
  );
}
