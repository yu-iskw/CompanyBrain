import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { Pool, type PoolConfig } from 'pg';

import type { AuditEvent, AuditSink } from '@company-brain/application';
import type { UserIdentity } from '@company-brain/domain';
import type { CredentialVault } from '@company-brain/plugin-sdk';

export interface SessionStore {
  get(id: string): Promise<UserIdentity | undefined>;
  put(id: string, identity: UserIdentity, expiresAt: Date): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface OAuthStateStore {
  put(
    state: string,
    flow: string,
    payload: Readonly<Record<string, string>>,
    expiresAt: Date,
  ): Promise<void>;
  take(state: string, flow: string): Promise<Readonly<Record<string, string>> | undefined>;
}

export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<
    string,
    { readonly identity: UserIdentity; readonly expiresAt: Date }
  >();

  get(id: string): Promise<UserIdentity | undefined> {
    const session = this.#sessions.get(id);
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      this.#sessions.delete(id);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(session.identity);
  }

  put(id: string, identity: UserIdentity, expiresAt: Date): Promise<void> {
    this.#sessions.set(id, { identity, expiresAt });
    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.#sessions.delete(id);
    return Promise.resolve();
  }
}

export class InMemoryOAuthStateStore implements OAuthStateStore {
  readonly #states = new Map<
    string,
    {
      readonly flow: string;
      readonly payload: Readonly<Record<string, string>>;
      readonly expiresAt: Date;
    }
  >();

  put(
    state: string,
    flow: string,
    payload: Readonly<Record<string, string>>,
    expiresAt: Date,
  ): Promise<void> {
    this.#states.set(state, { flow, payload, expiresAt });
    return Promise.resolve();
  }

  take(state: string, flow: string): Promise<Readonly<Record<string, string>> | undefined> {
    const stored = this.#states.get(state);
    this.#states.delete(state);
    if (!stored || stored.flow !== flow || stored.expiresAt.getTime() <= Date.now()) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(stored.payload);
  }
}

export interface DurableStore extends CredentialVault, AuditSink {
  initialize(): Promise<void>;
  close(): Promise<void>;
  getSessionAdapter(): SessionStore;
  getOAuthStateAdapter(): OAuthStateStore;
}

export class PostgresStore implements DurableStore {
  constructor(
    private readonly pool: Pool,
    private readonly encryptionKey: Buffer,
  ) {
    if (encryptionKey.length !== 32)
      throw new Error('Credential encryption key must contain 32 bytes');
  }

  static connect(
    connectionString: string,
    encryptionKeyBase64: string,
    poolConfig: PoolConfig = {},
  ): PostgresStore {
    const key = Buffer.from(encryptionKeyBase64, 'base64');
    return new PostgresStore(new Pool({ ...poolConfig, connectionString }), key);
  }

  async initialize(): Promise<void> {
    await this.pool.query(schema);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async get(subject: string, sourceId: string): Promise<string | undefined> {
    const result = await this.pool.query<EncryptedRow>(
      'SELECT ciphertext, nonce, auth_tag FROM company_brain_credentials WHERE subject = $1 AND source_id = $2',
      [subject, sourceId],
    );
    const row = result.rows[0];
    return row ? decrypt(row, this.encryptionKey, `${subject}:${sourceId}`) : undefined;
  }

  async put(subject: string, sourceId: string, accessToken: string): Promise<void> {
    const encrypted = encrypt(accessToken, this.encryptionKey, `${subject}:${sourceId}`);
    await this.pool.query(
      `INSERT INTO company_brain_credentials (subject, source_id, ciphertext, nonce, auth_tag)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (subject, source_id) DO UPDATE
       SET ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce, auth_tag = EXCLUDED.auth_tag, updated_at = now()`,
      [subject, sourceId, encrypted.ciphertext, encrypted.nonce, encrypted.authTag],
    );
  }

  async delete(subject: string, sourceId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM company_brain_credentials WHERE subject = $1 AND source_id = $2',
      [subject, sourceId],
    );
  }

  async getSession(id: string): Promise<UserIdentity | undefined> {
    const result = await this.pool.query<{ readonly identity: UserIdentity }>(
      'SELECT identity FROM company_brain_sessions WHERE id_hash = $1 AND expires_at > now()',
      [hash(id)],
    );
    return result.rows[0]?.identity;
  }

  async putSession(id: string, identity: UserIdentity, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO company_brain_sessions (id_hash, identity, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (id_hash) DO UPDATE SET identity = EXCLUDED.identity, expires_at = EXCLUDED.expires_at`,
      [hash(id), JSON.stringify(identity), expiresAt],
    );
  }

  async deleteSession(id: string): Promise<void> {
    await this.pool.query('DELETE FROM company_brain_sessions WHERE id_hash = $1', [hash(id)]);
  }

  async putState(
    state: string,
    flow: string,
    payload: Readonly<Record<string, string>>,
    expiresAt: Date,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO company_brain_oauth_states (state_hash, flow, payload, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [hash(state), flow, JSON.stringify(payload), expiresAt],
    );
  }

  async takeState(
    state: string,
    flow: string,
  ): Promise<Readonly<Record<string, string>> | undefined> {
    const result = await this.pool.query<{ readonly payload: Readonly<Record<string, string>> }>(
      `DELETE FROM company_brain_oauth_states
       WHERE state_hash = $1 AND flow = $2 AND expires_at > now()
       RETURNING payload`,
      [hash(state), flow],
    );
    return result.rows[0]?.payload;
  }

  async append(event: AuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO company_brain_audit_events
       (id, occurred_at, request_id, subject, action, source_ids, outcome, result_count, query_fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        event.id,
        event.timestamp,
        event.requestId,
        event.subject,
        event.action,
        event.sourceIds,
        event.outcome,
        event.resultCount,
        event.queryFingerprint ?? null,
      ],
    );
  }

  getSessionAdapter(): SessionStore {
    return {
      get: async (id) => this.getSession(id),
      put: async (id, identity, expiresAt) => this.putSession(id, identity, expiresAt),
      delete: async (id) => this.deleteSession(id),
    };
  }

  getOAuthStateAdapter(): OAuthStateStore {
    return {
      put: async (state, flow, payload, expiresAt) =>
        this.putState(state, flow, payload, expiresAt),
      take: async (state, flow) => this.takeState(state, flow),
    };
  }
}

interface EncryptedRow {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly auth_tag: Buffer;
}

function encrypt(
  plaintext: string,
  key: Buffer,
  associatedData: string,
): { ciphertext: Buffer; nonce: Buffer; authTag: Buffer } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

function decrypt(row: EncryptedRow, key: Buffer, associatedData: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key, row.nonce);
  decipher.setAAD(Buffer.from(associatedData));
  decipher.setAuthTag(row.auth_tag);
  return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8');
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

const schema = `
CREATE TABLE IF NOT EXISTS company_brain_credentials (
  subject text NOT NULL,
  source_id text NOT NULL,
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  auth_tag bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject, source_id)
);
CREATE TABLE IF NOT EXISTS company_brain_sessions (
  id_hash bytea PRIMARY KEY,
  identity jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS company_brain_sessions_expiry ON company_brain_sessions (expires_at);
CREATE TABLE IF NOT EXISTS company_brain_oauth_states (
  state_hash bytea PRIMARY KEY,
  flow text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS company_brain_oauth_states_expiry ON company_brain_oauth_states (expires_at);
CREATE TABLE IF NOT EXISTS company_brain_audit_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  request_id text NOT NULL,
  subject text NOT NULL,
  action text NOT NULL,
  source_ids text[] NOT NULL,
  outcome text NOT NULL,
  result_count integer NOT NULL,
  query_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_brain_audit_subject_time
  ON company_brain_audit_events (subject, occurred_at DESC);
`;
