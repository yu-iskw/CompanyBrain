import {
  CompanyBrainService,
  ConsoleAuditSink,
  PluginRegistry,
  type AuditSink,
} from '@company-brain/application';
import { GitHubPlugin } from '@company-brain/plugin-github';
import { InMemoryCredentialVault, type CredentialVault } from '@company-brain/plugin-sdk';
import { SlackPlugin } from '@company-brain/plugin-slack';

export interface CompanyBrainRuntime {
  readonly service: CompanyBrainService;
  readonly credentials: CredentialVault;
}

export function createRuntime(
  options: { readonly credentials?: CredentialVault; readonly audit?: AuditSink } = {},
): CompanyBrainRuntime {
  const credentials = options.credentials ?? new InMemoryCredentialVault();
  const registry = new PluginRegistry();
  registry.register(new SlackPlugin());
  registry.register(new GitHubPlugin());
  return {
    service: new CompanyBrainService(
      registry,
      credentials,
      options.audit ?? new ConsoleAuditSink(),
    ),
    credentials,
  };
}
