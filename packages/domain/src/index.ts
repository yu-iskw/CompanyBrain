export type KnowledgeObjectType =
  | 'document'
  | 'file'
  | 'issue'
  | 'pull-request'
  | 'repository'
  | 'slack-message'
  | 'slack-thread'
  | 'dataset'
  | 'table'
  | 'dashboard'
  | 'metric'
  | 'semantic-model';

export interface Citation {
  readonly sourceId: string;
  readonly objectId: string;
  readonly url: string;
  readonly title: string;
  readonly retrievedAt: string;
}

export interface KnowledgeObject {
  readonly id: string;
  readonly sourceId: string;
  readonly type: KnowledgeObjectType;
  readonly title: string;
  readonly excerpt: string;
  readonly url: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly author?: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
  readonly citation: Citation;
}

export interface UserIdentity {
  readonly subject: string;
  readonly tenantId?: string;
  readonly displayName?: string;
  readonly email?: string;
}

export interface SearchRequest {
  readonly query: string;
  readonly sourceIds?: readonly string[];
  readonly limit?: number;
}

export interface SearchResponse {
  readonly query: string;
  readonly results: readonly KnowledgeObject[];
  readonly failures: readonly SourceFailure[];
  readonly searchedSources: readonly string[];
}

export interface SourceFailure {
  readonly sourceId: string;
  readonly code: 'not-linked' | 'forbidden' | 'rate-limited' | 'unavailable' | 'invalid-request';
  readonly message: string;
}

export interface AccessExplanation {
  readonly sourceId: string;
  readonly mode: 'delegated-user';
  readonly summary: string;
  readonly requiredScopes: readonly string[];
}
