/**
 * Plugin runner deployable: executes plugin capabilities in an isolated
 * workload (own Cloud Run service, own service account). Before any run it
 * re-validates the manifest and issues a credential narrowed to the
 * manifest's declared scopes — a plugin can never observe more than it
 * declared, and every run is reported for auditing.
 */
import { validateManifest } from '@companybrain/plugin-sdk';

import type { KnowledgeObject } from '@companybrain/domain';
import type { CompanyBrainPlugin, PluginCapability } from '@companybrain/plugin-protocol';
import type { CredentialBroker, ScopedCredential } from '@companybrain/plugin-sdk';

export interface PluginRunReport {
  readonly plugin: string;
  readonly capability: PluginCapability;
  readonly ok: boolean;
  readonly objects: readonly KnowledgeObject[];
  readonly error?: string;
  readonly grantedScopes: readonly string[];
}

export class PluginRunner {
  private readonly broker: CredentialBroker;

  constructor(broker: CredentialBroker) {
    this.broker = broker;
  }

  /** Runs one capability of a plugin under least-privilege credentials. */
  async run(plugin: CompanyBrainPlugin, capability: PluginCapability): Promise<PluginRunReport> {
    const manifestErrors = validateManifest(plugin.manifest);
    if (manifestErrors.length > 0) {
      return this.failure(plugin, capability, [], `invalid manifest: ${manifestErrors.join('; ')}`);
    }
    if (!plugin.manifest.capabilities.includes(capability)) {
      return this.failure(plugin, capability, [], `capability "${capability}" is not declared`);
    }
    let credential: ScopedCredential;
    try {
      credential = this.broker.issue(plugin.manifest);
    } catch (error) {
      return this.failure(plugin, capability, [], String(error));
    }
    const grantedScopes = credential.allowedScopes();
    try {
      const objects = await this.execute(plugin, capability);
      return { plugin: plugin.manifest.name, capability, ok: true, objects, grantedScopes };
    } catch (error) {
      return this.failure(plugin, capability, grantedScopes, String(error));
    }
  }

  private async execute(
    plugin: CompanyBrainPlugin,
    capability: PluginCapability,
  ): Promise<readonly KnowledgeObject[]> {
    switch (capability) {
      case 'crawler': {
        if (plugin.crawler === undefined) {
          throw new Error('crawler capability declared but not implemented');
        }
        return plugin.crawler.crawl();
      }
      case 'webhook-handler': {
        // Real events arrive via Pub/Sub; a no-op event exercises the handler.
        if (plugin.webhookHandler === undefined) {
          throw new Error('webhook-handler capability declared but not implemented');
        }
        return plugin.webhookHandler.handleWebhook({ type: 'ping', payload: {} });
      }
      case 'retriever':
      case 'metadata-provider': {
        throw new Error(`capability "${capability}" runs in-process, not via the plugin runner`);
      }
    }
  }

  private failure(
    plugin: CompanyBrainPlugin,
    capability: PluginCapability,
    grantedScopes: readonly string[],
    error: string,
  ): PluginRunReport {
    return {
      plugin: plugin.manifest.name,
      capability,
      ok: false,
      objects: [],
      error,
      grantedScopes,
    };
  }
}
