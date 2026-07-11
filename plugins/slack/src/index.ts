/**
 * Slack source plugin. Channel membership drives the ACL: public channels
 * map to public visibility, private channels restrict to their members.
 */
import { definePlugin } from '@companybrain/plugin-sdk';

import type { AccessControlList, KnowledgeObject } from '@companybrain/domain';
import type { CompanyBrainPlugin } from '@companybrain/plugin-protocol';

export interface SlackThread {
  readonly id: string;
  readonly channel: string;
  readonly channelVisibility: 'public' | 'private';
  readonly channelMembers?: readonly string[];
  readonly topic: string;
  readonly messages: readonly string[];
  readonly url: string;
  readonly updatedAt: string;
}

function toAcl(thread: SlackThread): AccessControlList {
  if (thread.channelVisibility === 'public') {
    return { visibility: 'public', allowedPrincipals: [], allowedGroups: [] };
  }
  return {
    visibility: 'restricted',
    allowedPrincipals: [...(thread.channelMembers ?? [])],
    allowedGroups: [],
  };
}

export function toKnowledgeObject(thread: SlackThread): KnowledgeObject {
  return {
    ref: { source: 'slack', type: 'slack-thread', id: thread.id },
    title: thread.topic,
    content: thread.messages.join('\n'),
    uri: thread.url,
    updatedAt: thread.updatedAt,
    metadata: new Map([['channel', thread.channel]]),
    acl: toAcl(thread),
  };
}

export function createSlackPlugin(threads: readonly SlackThread[]): CompanyBrainPlugin {
  const objects = threads.map((thread) => toKnowledgeObject(thread));
  return definePlugin({
    manifest: {
      name: 'slack',
      version: '0.1.0',
      source: 'slack',
      capabilities: ['crawler', 'retriever', 'webhook-handler'],
      scopes: ['slack:channels:history', 'slack:channels:read'],
    },
    crawler: { crawl: () => Promise.resolve(objects) },
    retriever: {
      retrieve: (_principal, query) =>
        Promise.resolve(
          objects.filter((object) =>
            `${object.title} ${object.content}`.toLowerCase().includes(query.toLowerCase()),
          ),
        ),
    },
    webhookHandler: {
      handleWebhook: (event) => {
        const thread = event.payload.thread as SlackThread | undefined;
        return Promise.resolve(thread === undefined ? [] : [toKnowledgeObject(thread)]);
      },
    },
  });
}
