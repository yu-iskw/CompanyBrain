import { PluginRequestError } from '@company-brain/plugin-sdk';

import type { AccessExplanation, KnowledgeObject, SearchRequest } from '@company-brain/domain';
import type {
  KnowledgePlugin,
  PluginContext,
  PluginManifest,
  SearchPluginContext,
} from '@company-brain/plugin-sdk';

const SLACK_API = 'https://slack.com/api';

interface SlackMatch {
  readonly channel_id?: string;
  readonly channel_name?: string;
  readonly iid?: string;
  readonly permalink?: string;
  readonly text?: string;
  readonly ts?: string;
  readonly username?: string;
  readonly user_name?: string;
}

interface SlackSearchResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly messages?: { readonly matches?: readonly SlackMatch[] };
}

interface SlackHistoryResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly messages?: readonly SlackMatch[];
}

export class SlackPlugin implements KnowledgePlugin {
  readonly manifest: PluginManifest = {
    id: 'slack',
    displayName: 'Slack',
    version: '0.1.0',
    credentialType: 'oauth-user-token',
    metadataStorage: 'non-sensitive-only',
  };

  constructor(private readonly request: typeof fetch = fetch) {}

  explainAccess(): AccessExplanation {
    return {
      sourceId: 'slack',
      mode: 'delegated-user',
      summary:
        'Slack is queried live with the linked user token; results cannot exceed that user’s Slack access.',
      requiredScopes: [
        'search:read',
        'channels:history',
        'groups:history',
        'im:history',
        'mpim:history',
      ],
    };
  }

  async search(
    search: SearchRequest,
    context: SearchPluginContext,
  ): Promise<readonly KnowledgeObject[]> {
    const limit = Math.max(1, Math.min(100, context.resultLimit));
    const response = await this.call<SlackSearchResponse>(
      'search.messages',
      new URLSearchParams({ query: search.query, count: String(limit), sort: 'score' }),
      context,
    );
    return (response.messages?.matches ?? [])
      .slice(0, limit)
      .map((match) => toKnowledgeObject(match));
  }

  async getObject(objectId: string, context: PluginContext): Promise<KnowledgeObject | undefined> {
    const parsed = parseObjectId(objectId);
    const response = await this.call<SlackHistoryResponse>(
      'conversations.history',
      new URLSearchParams({
        channel: parsed.channelId,
        oldest: parsed.timestamp,
        latest: parsed.timestamp,
        inclusive: 'true',
        limit: '1',
      }),
      context,
    );
    const message = response.messages?.[0];
    if (!message) return undefined;
    return toKnowledgeObject({ ...message, channel_id: parsed.channelId });
  }

  private async call<T extends { readonly ok: boolean; readonly error?: string }>(
    method: string,
    parameters: URLSearchParams,
    context: PluginContext,
  ): Promise<T> {
    const response = await this.request(`${SLACK_API}/${method}?${parameters.toString()}`, {
      headers: { authorization: `Bearer ${context.accessToken}` },
    });
    if (!response.ok) {
      if (response.status === 403) throw new PluginRequestError(`Slack HTTP 403`, 'forbidden');
      if (response.status === 429) throw new PluginRequestError(`Slack HTTP 429`, 'rate-limited');
      throw new Error(`Slack HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    if (!isSlackResponse(payload)) throw new Error('Slack returned an invalid response');
    if (!payload.ok) {
      const message = `Slack API error: ${payload.error ?? 'unknown_error'}`;
      if (payload.error === 'missing_scope' || payload.error === 'not_allowed_token_type') {
        throw new PluginRequestError(message, 'forbidden');
      }
      if (payload.error === 'ratelimited') {
        throw new PluginRequestError(message, 'rate-limited');
      }
      throw new Error(message);
    }
    return payload as T;
  }
}

function isSlackResponse(
  value: unknown,
): value is { readonly ok: boolean; readonly error?: string } {
  return (
    typeof value === 'object' && value !== null && 'ok' in value && typeof value.ok === 'boolean'
  );
}

function toKnowledgeObject(match: SlackMatch): KnowledgeObject {
  const timestamp = required(match.ts, 'Slack result is missing a timestamp');
  const channelId = required(match.channel_id, 'Slack result is missing a channel ID');
  const objectId = makeObjectId(channelId, timestamp);
  const channelName = match.channel_name ?? channelId;
  const url = match.permalink ?? `https://app.slack.com/client/${channelId}`;
  const title = `#${channelName} message`;
  return {
    id: `slack:${objectId}`,
    sourceId: 'slack',
    type: 'slack-message',
    title,
    excerpt: normalizeSlackText(match.text ?? ''),
    url,
    createdAt: slackTimestampToIso(timestamp),
    author: match.username ?? match.user_name,
    metadata: { channelId, channelName, timestamp },
    citation: {
      sourceId: 'slack',
      objectId,
      url,
      title,
      retrievedAt: new Date().toISOString(),
    },
  };
}

function normalizeSlackText(text: string): string {
  return text
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    .trim();
}

function makeObjectId(channelId: string, timestamp: string): string {
  return Buffer.from(JSON.stringify({ channelId, timestamp }), 'utf8').toString('base64url');
}

function parseObjectId(objectId: string): { channelId: string; timestamp: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(objectId, 'base64url').toString('utf8'));
    if (
      typeof value === 'object' &&
      value !== null &&
      'channelId' in value &&
      'timestamp' in value &&
      typeof value.channelId === 'string' &&
      typeof value.timestamp === 'string'
    ) {
      return { channelId: value.channelId, timestamp: value.timestamp };
    }
  } catch {
    // Converted to a stable domain error below.
  }
  throw new PluginRequestError('Invalid Slack object ID', 'invalid-request');
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function slackTimestampToIso(timestamp: string): string {
  const seconds = Number(timestamp.split('.')[0]);
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : new Date(0).toISOString();
}
