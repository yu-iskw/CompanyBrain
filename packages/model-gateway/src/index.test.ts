import { describe, expect, it } from 'vitest';

import { createExtractiveProvider, ModelGateway } from './index';

import type { ModelProvider } from './index';

const echo: ModelProvider = {
  name: 'echo',
  complete: (request) => Promise.resolve({ provider: 'echo', text: request.prompt }),
};

describe('ModelGateway', () => {
  it('routes to the default provider', async () => {
    const gateway = new ModelGateway();
    gateway.register(echo);
    const response = await gateway.complete({ prompt: 'hello', contextPassages: [] });
    expect(response).toEqual({ provider: 'echo', text: 'hello' });
  });

  it('routes to a named provider and honours explicit defaults', async () => {
    const gateway = new ModelGateway();
    gateway.register(echo);
    gateway.register(createExtractiveProvider(), { isDefault: true });
    expect(gateway.listProviders()).toEqual(['echo', 'extractive']);
    const byName = await gateway.complete({ prompt: 'hi', contextPassages: [] }, 'echo');
    expect(byName.provider).toBe('echo');
    const byDefault = await gateway.complete({ prompt: 'hi', contextPassages: [] });
    expect(byDefault.provider).toBe('extractive');
  });

  it('throws for unknown or missing providers', async () => {
    const gateway = new ModelGateway();
    await expect(gateway.complete({ prompt: 'x', contextPassages: [] })).rejects.toThrow(
      /no model provider/,
    );
    gateway.register(echo);
    await expect(gateway.complete({ prompt: 'x', contextPassages: [] }, 'gpt')).rejects.toThrow(
      /unknown model provider/,
    );
  });
});

describe('extractive provider', () => {
  it('returns the most relevant passages verbatim', async () => {
    const provider = createExtractiveProvider();
    const response = await provider.complete({
      prompt: 'How do we rotate database credentials?',
      contextPassages: [
        'Database credentials are rotated quarterly by the platform team.',
        'The cafeteria serves lunch from noon.',
      ],
    });
    expect(response.text).toBe('Database credentials are rotated quarterly by the platform team.');
  });

  it('admits when nothing in context answers the prompt', async () => {
    const provider = createExtractiveProvider();
    const response = await provider.complete({
      prompt: 'quantum',
      contextPassages: ['lunch menu'],
    });
    expect(response.text).toContain('No grounded answer');
  });
});
