import { CredentialBroker } from '@companybrain/plugin-sdk';
import { buildKnowledgeObject, createInMemoryPlugin } from '@companybrain/testing';
import { describe, expect, it } from 'vitest';

import { PluginRunner } from './index';

import type { CompanyBrainPlugin } from '@companybrain/plugin-protocol';

function makeRunner(): PluginRunner {
  const broker = new CredentialBroker();
  broker.registerSecret('wiki', 'projects/p/secrets/wiki-token');
  return new PluginRunner(broker);
}

describe('PluginRunner', () => {
  it('runs a declared crawler under scoped credentials', async () => {
    const plugin = createInMemoryPlugin('wiki', [buildKnowledgeObject()]);
    const report = await makeRunner().run(plugin, 'crawler');
    expect(report.ok).toBe(true);
    expect(report.objects).toHaveLength(1);
    expect(report.grantedScopes).toEqual(['wiki:read']);
  });

  it('refuses undeclared capabilities', async () => {
    const plugin = createInMemoryPlugin('wiki', []);
    const report = await makeRunner().run(plugin, 'webhook-handler');
    expect(report.ok).toBe(false);
    expect(report.error).toContain('not declared');
  });

  it('refuses plugins with invalid manifests', async () => {
    const broken: CompanyBrainPlugin = {
      manifest: { name: '', version: 'x', source: 'wiki', capabilities: [], scopes: [] },
    };
    const report = await makeRunner().run(broken, 'crawler');
    expect(report.ok).toBe(false);
    expect(report.error).toContain('invalid manifest');
  });

  it('fails when no secret is registered for the source', async () => {
    const runner = new PluginRunner(new CredentialBroker());
    const report = await runner.run(createInMemoryPlugin('wiki', []), 'crawler');
    expect(report.ok).toBe(false);
    expect(report.error).toContain('no secret registered');
  });

  it('rejects in-process capabilities', async () => {
    const plugin = createInMemoryPlugin('wiki', []);
    const report = await makeRunner().run(plugin, 'retriever');
    expect(report.ok).toBe(false);
    expect(report.error).toContain('in-process');
  });
});
