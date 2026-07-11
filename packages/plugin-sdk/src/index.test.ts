import { describe, expect, it } from 'vitest';

import { CredentialBroker, definePlugin, ScopedCredential, validateManifest } from './index';

import type { CapabilityManifest, CompanyBrainPlugin } from '@companybrain/plugin-protocol';

const manifest: CapabilityManifest = {
  name: 'github',
  version: '1.0.0',
  source: 'github',
  capabilities: ['crawler'],
  scopes: ['github:read:issues'],
};

const crawler = { crawl: () => Promise.resolve([]) };

describe('validateManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('rejects empty names, bad versions, and unknown capabilities', () => {
    const errors = validateManifest({
      name: '',
      version: 'latest',
      source: ' ',
      capabilities: ['crawler', 'exfiltrator' as never],
      scopes: [],
    });
    expect(errors).toHaveLength(4);
  });
});

describe('definePlugin', () => {
  it('returns a frozen plugin when implementation matches the manifest', () => {
    const plugin = definePlugin({ manifest, crawler });
    expect(Object.isFrozen(plugin)).toBe(true);
    expect(plugin.manifest.name).toBe('github');
  });

  it('rejects declared-but-missing capabilities', () => {
    expect(() => definePlugin({ manifest })).toThrow(/declared but not implemented/);
  });

  it('rejects undeclared implementations (least privilege)', () => {
    const sneaky: CompanyBrainPlugin = {
      manifest,
      crawler,
      retriever: { retrieve: () => Promise.resolve([]) },
    };
    expect(() => definePlugin(sneaky)).toThrow(/implemented but not declared/);
  });
});

describe('ScopedCredential', () => {
  it('only releases the secret for granted scopes', () => {
    const credential = new ScopedCredential('projects/p/secrets/github-token', [
      'github:read:issues',
    ]);
    expect(credential.use('github:read:issues')).toBe('projects/p/secrets/github-token');
    expect(() => credential.use('github:write:issues')).toThrow(/does not grant scope/);
    expect(credential.allowedScopes()).toEqual(['github:read:issues']);
  });
});

describe('CredentialBroker', () => {
  it('issues credentials narrowed to the manifest scopes', () => {
    const broker = new CredentialBroker();
    broker.registerSecret('github', 'projects/p/secrets/github-token');
    const credential = broker.issue(manifest);
    expect(credential.allowedScopes()).toEqual(['github:read:issues']);
    expect(() => credential.use('github:admin')).toThrow();
  });

  it('refuses to issue credentials for unknown sources', () => {
    const broker = new CredentialBroker();
    expect(() => broker.issue(manifest)).toThrow(/no secret registered/);
  });
});
