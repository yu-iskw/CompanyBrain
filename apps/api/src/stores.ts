import { ConsoleAuditSink, type AuditSink } from '@company-brain/application';
import {
  InMemoryOAuthStateStore,
  InMemorySessionStore,
  PostgresStore,
  type OAuthStateStore,
  type SessionStore,
} from '@company-brain/persistence';
import { InMemoryCredentialVault, type CredentialVault } from '@company-brain/plugin-sdk';

import type { AppConfig } from './config.js';

interface Stores {
  readonly audit: AuditSink;
  readonly credentials: CredentialVault;
  readonly oauthStates: OAuthStateStore;
  readonly sessions: SessionStore;
  close(): Promise<void>;
}

export async function createStores(config: AppConfig): Promise<Stores> {
  if (!config.database) {
    return {
      audit: new ConsoleAuditSink(),
      credentials: new InMemoryCredentialVault(),
      oauthStates: new InMemoryOAuthStateStore(),
      sessions: new InMemorySessionStore(),
      close: () => Promise.resolve(),
    };
  }
  const durable = PostgresStore.connect(
    config.database.connectionString,
    config.database.credentialEncryptionKey,
  );
  await durable.initialize();
  return {
    audit: durable,
    credentials: durable,
    oauthStates: durable.getOAuthStateAdapter(),
    sessions: durable.getSessionAdapter(),
    close: async () => durable.close(),
  };
}
