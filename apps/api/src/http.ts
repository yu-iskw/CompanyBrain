import type { ServerResponse } from 'node:http';

/** Client-facing failures mapped to HTTP 400 by the API. */
export class ClientFacingError extends Error {}

export function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location });
  response.end();
}
