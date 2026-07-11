/**
 * Plugin SDK: helpers for building CompanyBrain plugins.
 *
 * - `definePlugin` validates that a plugin's implementation matches its
 *   capability manifest (no undeclared capabilities, no missing ones).
 * - `CredentialBroker` / `ScopedCredential` enforce that plugins only ever
 *   receive credentials narrowed to their declared scopes.
 */
import { PLUGIN_CAPABILITIES } from '@companybrain/plugin-protocol';

import type {
  CapabilityManifest,
  CompanyBrainPlugin,
  PluginCapability,
} from '@companybrain/plugin-protocol';

export function validateManifest(manifest: CapabilityManifest): string[] {
  const errors: string[] = [];
  if (manifest.name.trim() === '') {
    errors.push('manifest.name must not be empty');
  }
  if (manifest.source.trim() === '') {
    errors.push('manifest.source must not be empty');
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    errors.push(`manifest.version "${manifest.version}" must be semver (x.y.z)`);
  }
  if (manifest.capabilities.length === 0) {
    errors.push('manifest must declare at least one capability');
  }
  for (const capability of manifest.capabilities) {
    if (!(PLUGIN_CAPABILITIES as readonly string[]).includes(capability)) {
      errors.push(`unknown capability "${capability}"`);
    }
  }
  return errors;
}

const CAPABILITY_IMPLEMENTATIONS: ReadonlyMap<
  PluginCapability,
  (plugin: CompanyBrainPlugin) => unknown
> = new Map<PluginCapability, (plugin: CompanyBrainPlugin) => unknown>([
  ['crawler', (plugin: CompanyBrainPlugin) => plugin.crawler],
  ['retriever', (plugin: CompanyBrainPlugin) => plugin.retriever],
  ['metadata-provider', (plugin: CompanyBrainPlugin) => plugin.metadataProvider],
  ['webhook-handler', (plugin: CompanyBrainPlugin) => plugin.webhookHandler],
]);

/**
 * Validates a plugin definition against its manifest and freezes it.
 * Throws when the implementation and the declared capabilities disagree.
 */
export function definePlugin(plugin: CompanyBrainPlugin): CompanyBrainPlugin {
  const errors = validateManifest(plugin.manifest);
  for (const [capability, implementationOf] of CAPABILITY_IMPLEMENTATIONS) {
    const declared = plugin.manifest.capabilities.includes(capability);
    const implemented = implementationOf(plugin) !== undefined;
    if (declared && !implemented) {
      errors.push(`capability "${capability}" is declared but not implemented`);
    }
    if (!declared && implemented) {
      errors.push(`capability "${capability}" is implemented but not declared`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`invalid plugin "${plugin.manifest.name}": ${errors.join('; ')}`);
  }
  return Object.freeze({ ...plugin });
}

/**
 * A credential narrowed to an explicit scope set. Plugins receive these
 * instead of raw secrets and must name the scope on every use, which keeps
 * usage auditable and blocks scope creep at runtime.
 */
export class ScopedCredential {
  private readonly scopes: ReadonlySet<string>;
  private readonly secretRef: string;

  constructor(secretRef: string, scopes: readonly string[]) {
    this.secretRef = secretRef;
    this.scopes = new Set(scopes);
  }

  allowedScopes(): readonly string[] {
    return [...this.scopes].sort((a, b) => a.localeCompare(b));
  }

  /** Returns the secret reference for an allowed scope; throws otherwise. */
  use(scope: string): string {
    if (!this.scopes.has(scope)) {
      throw new Error(`credential does not grant scope "${scope}"`);
    }
    return this.secretRef;
  }
}

/**
 * Issues scoped credentials to plugins. The broker holds references into the
 * secret store (e.g. Secret Manager resource names), never secret values.
 */
export class CredentialBroker {
  private readonly secretRefs = new Map<string, string>();

  registerSecret(source: string, secretRef: string): void {
    this.secretRefs.set(source, secretRef);
  }

  /** Grants a credential narrowed to the manifest's declared scopes. */
  issue(manifest: CapabilityManifest): ScopedCredential {
    const secretRef = this.secretRefs.get(manifest.source);
    if (secretRef === undefined) {
      throw new Error(`no secret registered for source "${manifest.source}"`);
    }
    return new ScopedCredential(secretRef, manifest.scopes);
  }
}
