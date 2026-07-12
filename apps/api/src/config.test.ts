import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('defaults to an unauthenticated local identity outside production', () => {
    const config = loadConfig({});
    expect(config.auth).toEqual({ mode: 'local', subject: 'local-developer' });
  });

  it('forbids local authentication in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'local' })).toThrow(
      'AUTH_MODE=local is forbidden',
    );
  });

  it('requires durable persistence in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        AUTH_MODE: 'oidc',
        OIDC_AUTHORIZATION_URL: 'https://identity.example/authorize',
        OIDC_TOKEN_URL: 'https://identity.example/token',
        OIDC_USERINFO_URL: 'https://identity.example/userinfo',
        OIDC_CLIENT_ID: 'client',
      }),
    ).toThrow('DATABASE_URL and CREDENTIAL_ENCRYPTION_KEY are required in production');
  });

  it('rejects partial database configuration', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://localhost/db' })).toThrow(
      'DATABASE_URL and CREDENTIAL_ENCRYPTION_KEY must both be set, or neither',
    );
    expect(() => loadConfig({ CREDENTIAL_ENCRYPTION_KEY: 'dGVzdA==' })).toThrow(
      'DATABASE_URL and CREDENTIAL_ENCRYPTION_KEY must both be set, or neither',
    );
  });
});
