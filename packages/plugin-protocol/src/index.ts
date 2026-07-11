/**
 * Plugin protocol: the contract between CompanyBrain and source-system
 * plugins. Plugins declare capabilities in a manifest and implement only the
 * interfaces they declare; the runtime grants scopes accordingly (least
 * privilege) and never hands plugins unrestricted credentials.
 */
import type { KnowledgeObject, KnowledgeObjectRef, Principal } from '@companybrain/domain';

export const PLUGIN_CAPABILITIES = [
  'crawler',
  'retriever',
  'metadata-provider',
  'webhook-handler',
] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export interface CapabilityManifest {
  /** Plugin name, e.g. "github". */
  readonly name: string;
  readonly version: string;
  /** Source system this plugin federates, e.g. "github". */
  readonly source: string;
  readonly capabilities: readonly PluginCapability[];
  /** Credential scopes the plugin needs, e.g. "github:read:issues". */
  readonly scopes: readonly string[];
}

/** Bulk-ingests objects from the source system (scheduled crawls). */
export interface Crawler {
  crawl(): Promise<readonly KnowledgeObject[]>;
}

/** Live, delegated-identity retrieval against the source system. */
export interface Retriever {
  retrieve(principal: Principal, query: string): Promise<readonly KnowledgeObject[]>;
}

/** Enriches objects with source-specific metadata. */
export interface MetadataProvider {
  getMetadata(ref: KnowledgeObjectRef): Promise<ReadonlyMap<string, string> | undefined>;
}

export interface WebhookEvent {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Converts source-system change events into updated knowledge objects. */
export interface WebhookHandler {
  handleWebhook(event: WebhookEvent): Promise<readonly KnowledgeObject[]>;
}

export interface CompanyBrainPlugin {
  readonly manifest: CapabilityManifest;
  readonly crawler?: Crawler;
  readonly retriever?: Retriever;
  readonly metadataProvider?: MetadataProvider;
  readonly webhookHandler?: WebhookHandler;
}
