export interface AppConfig {
  readonly baseUrl: string;
  readonly port: number;
  readonly production: boolean;
  readonly auth: LocalAuthConfig | OidcAuthConfig;
  readonly slack?: SlackOAuthConfig;
  readonly github?: GitHubOAuthConfig;
  readonly database?: DatabaseConfig;
}

export interface LocalAuthConfig {
  readonly mode: 'local';
  readonly subject: string;
}

export interface OidcAuthConfig {
  readonly mode: 'oidc';
  readonly authorizationUrl: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly tokenUrl: string;
  readonly userInfoUrl: string;
  readonly scopes: string;
}

export interface SlackOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface GitHubOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface DatabaseConfig {
  readonly connectionString: string;
  readonly credentialEncryptionKey: string;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = environment.NODE_ENV === 'production';
  const baseUrl = environment.BASE_URL ?? 'http://localhost:3000';
  const authMode = environment.AUTH_MODE ?? (production ? 'oidc' : 'local');
  if (production && authMode === 'local') {
    throw new Error('AUTH_MODE=local is forbidden when NODE_ENV=production');
  }
  const auth = authMode === 'local' ? localAuth(environment) : oidcAuth(environment);
  return {
    baseUrl,
    port: readPort(environment.PORT),
    production,
    auth,
    slack: slackOAuth(environment, baseUrl),
    github: githubOAuth(environment, baseUrl),
    database: database(environment, production),
  };
}

function githubOAuth(
  environment: NodeJS.ProcessEnv,
  baseUrl: string,
): GitHubOAuthConfig | undefined {
  if (!environment.GITHUB_CLIENT_ID || !environment.GITHUB_CLIENT_SECRET) return undefined;
  return {
    clientId: environment.GITHUB_CLIENT_ID,
    clientSecret: environment.GITHUB_CLIENT_SECRET,
    redirectUri: environment.GITHUB_REDIRECT_URI ?? `${baseUrl}/oauth/github/callback`,
  };
}

function database(environment: NodeJS.ProcessEnv, production: boolean): DatabaseConfig | undefined {
  if (!environment.DATABASE_URL || !environment.CREDENTIAL_ENCRYPTION_KEY) {
    if (production) {
      throw new Error('DATABASE_URL and CREDENTIAL_ENCRYPTION_KEY are required in production');
    }
    return undefined;
  }
  return {
    connectionString: environment.DATABASE_URL,
    credentialEncryptionKey: environment.CREDENTIAL_ENCRYPTION_KEY,
  };
}

function localAuth(environment: NodeJS.ProcessEnv): LocalAuthConfig {
  return { mode: 'local', subject: environment.LOCAL_USER_SUBJECT ?? 'local-developer' };
}

function oidcAuth(environment: NodeJS.ProcessEnv): OidcAuthConfig {
  return {
    mode: 'oidc',
    authorizationUrl: required(environment.OIDC_AUTHORIZATION_URL, 'OIDC_AUTHORIZATION_URL'),
    tokenUrl: required(environment.OIDC_TOKEN_URL, 'OIDC_TOKEN_URL'),
    userInfoUrl: required(environment.OIDC_USERINFO_URL, 'OIDC_USERINFO_URL'),
    clientId: required(environment.OIDC_CLIENT_ID, 'OIDC_CLIENT_ID'),
    clientSecret: environment.OIDC_CLIENT_SECRET,
    scopes: environment.OIDC_SCOPES ?? 'openid profile email',
  };
}

function slackOAuth(environment: NodeJS.ProcessEnv, baseUrl: string): SlackOAuthConfig | undefined {
  if (!environment.SLACK_CLIENT_ID || !environment.SLACK_CLIENT_SECRET) return undefined;
  return {
    clientId: environment.SLACK_CLIENT_ID,
    clientSecret: environment.SLACK_CLIENT_SECRET,
    redirectUri: environment.SLACK_REDIRECT_URI ?? `${baseUrl}/oauth/slack/callback`,
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readPort(value: string | undefined): number {
  const port = Number(value ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('PORT must be a valid TCP port');
  return port;
}
