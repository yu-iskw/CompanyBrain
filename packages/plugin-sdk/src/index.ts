import type {
  AccessExplanation,
  KnowledgeObject,
  SearchRequest,
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

export interface KnowledgePlugin {
  readonly manifest: PluginManifest;
  search(request: SearchRequest, context: PluginContext): Promise<readonly KnowledgeObject[]>;
  getObject(objectId: string, context: PluginContext): Promise<KnowledgeObject | undefined>;
  explainAccess(): AccessExplanation;
}

export interface CredentialVault {
  get(subject: string, sourceId: string): Promise<string | undefined>;
  put(subject: string, sourceId: string, accessToken: string): Promise<void>;
  delete(subject: string, sourceId: string): Promise<void>;
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
