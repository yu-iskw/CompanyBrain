import { describe, expect, it } from 'vitest';

import { InMemoryCredentialVault } from './index.js';

describe('InMemoryCredentialVault', () => {
  it('isolates credentials by subject and source', async () => {
    const vault = new InMemoryCredentialVault();
    await vault.put('alice', 'slack', 'alice-slack');
    await vault.put('alice', 'github', 'alice-github');

    expect(await vault.get('alice', 'slack')).toBe('alice-slack');
    expect(await vault.get('alice', 'github')).toBe('alice-github');
    expect(await vault.get('bob', 'slack')).toBeUndefined();
  });

  it('deletes only the selected credential', async () => {
    const vault = new InMemoryCredentialVault();
    await vault.put('alice', 'slack', 'alice-slack');
    await vault.put('bob', 'slack', 'bob-slack');

    await vault.delete('alice', 'slack');

    expect(await vault.get('alice', 'slack')).toBeUndefined();
    expect(await vault.get('bob', 'slack')).toBe('bob-slack');
  });
});
