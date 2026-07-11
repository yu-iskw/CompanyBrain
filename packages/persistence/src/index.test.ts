import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InMemoryOAuthStateStore, InMemorySessionStore, PostgresStore } from './index.js';

describe('in-memory durable-store ports', () => {
  it('expires sessions', async () => {
    const sessions = new InMemorySessionStore();
    await sessions.put('live', { subject: 'alice' }, new Date(Date.now() + 60_000));
    await sessions.put('expired', { subject: 'bob' }, new Date(Date.now() - 1));

    expect(await sessions.get('live')).toEqual({ subject: 'alice' });
    expect(await sessions.get('expired')).toBeUndefined();
    await sessions.delete('live');
    expect(await sessions.get('live')).toBeUndefined();
  });

  it('consumes OAuth state once and binds it to a flow', async () => {
    const states = new InMemoryOAuthStateStore();
    await states.put('state', 'github', { subject: 'alice' }, new Date(Date.now() + 60_000));

    expect(await states.take('state', 'slack')).toBeUndefined();
    expect(await states.take('state', 'github')).toEqual({ subject: 'alice' });
    expect(await states.take('state', 'github')).toBeUndefined();

    await states.put('state-2', 'github', { subject: 'alice' }, new Date(Date.now() + 60_000));
    expect(await states.take('state-2', 'github')).toEqual({ subject: 'alice' });
    expect(await states.take('state-2', 'github')).toBeUndefined();
  });
});

describe('PostgresStore credential encryption', () => {
  it('encrypts delegated tokens before persistence and decrypts with bound context', async () => {
    let row:
      | { readonly ciphertext: Buffer; readonly nonce: Buffer; readonly auth_tag: Buffer }
      | undefined;
    const pool = {
      query: (sql: string, parameters: readonly unknown[]) => {
        if (sql.startsWith('INSERT')) {
          row = {
            ciphertext: parameters[2] as Buffer,
            nonce: parameters[3] as Buffer,
            auth_tag: parameters[4] as Buffer,
          };
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: row ? [row] : [] });
      },
      end: () => Promise.resolve(),
    };
    const store = new PostgresStore(pool as never, randomBytes(32));

    await store.put('alice', 'github', 'github-secret-token');

    expect(row?.ciphertext.toString('utf8')).not.toContain('github-secret-token');
    await expect(store.get('alice', 'github')).resolves.toBe('github-secret-token');
  });

  it('rejects invalid encryption keys', () => {
    expect(() => new PostgresStore({} as never, randomBytes(16))).toThrow('32 bytes');
  });

  it('persists sessions, OAuth state, audit events, and supports lifecycle adapters', async () => {
    const queries: string[] = [];
    const pool = {
      query: (sql: string) => {
        queries.push(sql);
        if (sql.startsWith('SELECT identity')) {
          return Promise.resolve({ rows: [{ identity: { subject: 'alice' } }] });
        }
        if (sql.startsWith('DELETE FROM company_brain_oauth_states')) {
          return Promise.resolve({ rows: [{ payload: { subject: 'alice' } }] });
        }
        return Promise.resolve({ rows: [] });
      },
      end: () => Promise.resolve(),
    };
    const store = new PostgresStore(pool as never, randomBytes(32));
    const sessions = store.getSessionAdapter();
    const states = store.getOAuthStateAdapter();

    await store.initialize();
    await sessions.put('session', { subject: 'alice' }, new Date(Date.now() + 1_000));
    await expect(sessions.get('session')).resolves.toEqual({ subject: 'alice' });
    await sessions.delete('session');
    await states.put('state', 'github', { subject: 'alice' }, new Date(Date.now() + 1_000));
    await expect(states.take('state', 'github')).resolves.toEqual({ subject: 'alice' });
    await store.delete('alice', 'github');
    await store.append({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      requestId: 'request',
      subject: 'alice',
      action: 'search',
      sourceIds: ['github'],
      outcome: 'success',
      resultCount: 1,
    });
    await store.close();

    expect(queries.some((query) => query.includes('CREATE TABLE'))).toBe(true);
    expect(queries.some((query) => query.includes('company_brain_audit_events'))).toBe(true);
  });
});
