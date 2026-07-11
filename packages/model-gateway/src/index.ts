/**
 * Model-agnostic gateway. Application code depends only on this interface;
 * concrete providers (Anthropic, Vertex AI, self-hosted...) are registered at
 * deploy time. Phase 1 uses models only for optional answer synthesis, so a
 * deterministic extractive provider ships as the default.
 */

export interface ModelRequest {
  readonly prompt: string;
  /** Grounding passages the model must answer from. */
  readonly contextPassages: readonly string[];
  readonly maxTokens?: number;
}

export interface ModelResponse {
  readonly provider: string;
  readonly text: string;
}

export interface ModelProvider {
  readonly name: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export class ModelGateway {
  private readonly providers = new Map<string, ModelProvider>();
  private defaultProviderName: string | undefined;

  register(provider: ModelProvider, options: { isDefault?: boolean } = {}): void {
    this.providers.set(provider.name, provider);
    if (options.isDefault === true || this.defaultProviderName === undefined) {
      this.defaultProviderName = provider.name;
    }
  }

  listProviders(): readonly string[] {
    return [...this.providers.keys()];
  }

  async complete(request: ModelRequest, providerName?: string): Promise<ModelResponse> {
    const name = providerName ?? this.defaultProviderName;
    if (name === undefined) {
      throw new Error('no model provider registered');
    }
    const provider = this.providers.get(name);
    if (provider === undefined) {
      throw new Error(`unknown model provider "${name}"`);
    }
    return provider.complete(request);
  }
}

/**
 * Deterministic extractive provider: returns the most prompt-relevant
 * passages verbatim. Keeps Phase 1 grounded and dependency-free.
 */
export function createExtractiveProvider(): ModelProvider {
  return {
    name: 'extractive',
    complete: (request) => {
      const promptTerms = new Set(
        request.prompt
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((t) => t.length > 1),
      );
      const scored = request.contextPassages
        .map((passage) => {
          const terms = passage.toLowerCase().split(/[^\p{L}\p{N}]+/u);
          const overlap = terms.filter((t) => promptTerms.has(t)).length;
          return { passage, overlap };
        })
        .filter(({ overlap }) => overlap > 0)
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, 3);
      const text =
        scored.length === 0
          ? 'No grounded answer found in the provided context.'
          : scored.map(({ passage }) => passage).join('\n\n');
      return Promise.resolve({ provider: 'extractive', text });
    },
  };
}
