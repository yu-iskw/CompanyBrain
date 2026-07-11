import type {
  AccessExplanation,
  KnowledgeObject,
  SearchRequest,
  SourceFailure,
  UserIdentity,
} from '@company-brain/domain';

export interface PluginManifest {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly credentialType: 'oauth-user-token';
  readonly metadataStorage: 'non-sensitive-only';
}

export interface PluginContext {
  readonly identity: UserIdentity;
  readonly accessToken: string;
  readonly requestId: string;
}

export interface SearchPluginContext extends PluginContext {
  /** Per-plugin result budget from the application layer (already normalized). */
  readonly resultLimit: number;
}

export type PluginFailureCode = Exclude<SourceFailure['code'], 'not-linked'>;

export interface KnowledgePlugin {
  readonly manifest: PluginManifest;
  search(request: SearchRequest, context: SearchPluginContext): Promise<readonly KnowledgeObject[]>;
  getObject(objectId: string, context: PluginContext): Promise<KnowledgeObject | undefined>;
  explainAccess(): AccessExplanation;
}

export interface CredentialVault {
  get(subject: string, sourceId: string): Promise<string | undefined>;
  put(subject: string, sourceId: string, accessToken: string): Promise<void>;
  delete(subject: string, sourceId: string): Promise<void>;
}

export class PluginRequestError extends Error {
  constructor(
    message: string,
    readonly code: PluginFailureCode,
  ) {
    super(message);
    this.name = 'PluginRequestError';
  }
}

export class InMemoryCredentialVault implements CredentialVault {
  readonly #tokens = new Map<string, string>();

  get(subject: string, sourceId: string): Promise<string | undefined> {
    return Promise.resolve(this.#tokens.get(`${subject}:${sourceId}`));
  }

  put(subject: string, sourceId: string, accessToken: string): Promise<void> {
    this.#tokens.set(`${subject}:${sourceId}`, accessToken);
    return Promise.resolve();
  }

  delete(subject: string, sourceId: string): Promise<void> {
    this.#tokens.delete(`${subject}:${sourceId}`);
    return Promise.resolve();
  }
}
