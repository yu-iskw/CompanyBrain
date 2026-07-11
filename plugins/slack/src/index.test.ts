import { describe, expect, it } from 'vitest';

import { createSlackPlugin, toKnowledgeObject } from './index';

import type { SlackThread } from './index';

const publicThread: SlackThread = {
  id: 'C1-1720000000',
  channel: '#incidents',
  channelVisibility: 'public',
  topic: 'Database failover',
  messages: ['Primary is down', 'Failover completed at 12:04'],
  url: 'https://slack.example.com/archives/C1/p1720000000',
  updatedAt: '2026-06-10T00:00:00Z',
};

const privateThread: SlackThread = {
  id: 'C2-1720000001',
  channel: '#exec',
  channelVisibility: 'private',
  channelMembers: ['ceo', 'cfo'],
  topic: 'Budget review',
  messages: ['Q3 numbers attached'],
  url: 'https://slack.example.com/archives/C2/p1720000001',
  updatedAt: '2026-06-11T00:00:00Z',
};

describe('slack plugin', () => {
  it('maps channel visibility to ACLs and joins messages', () => {
    const object = toKnowledgeObject(publicThread);
    expect(object.ref.type).toBe('slack-thread');
    expect(object.acl.visibility).toBe('public');
    expect(object.content).toContain('Failover completed');
    expect(toKnowledgeObject(privateThread).acl.allowedPrincipals).toEqual(['ceo', 'cfo']);
  });

  it('crawls, retrieves, and handles webhooks', async () => {
    const plugin = createSlackPlugin([publicThread]);
    await expect(plugin.crawler?.crawl()).resolves.toHaveLength(1);
    const hits = await plugin.retriever?.retrieve({ id: 'u', groups: [] }, 'failover');
    expect(hits?.map((o) => o.ref.id)).toEqual(['C1-1720000000']);
    const changed = await plugin.webhookHandler?.handleWebhook({
      type: 'message',
      payload: { thread: privateThread },
    });
    expect(changed?.map((o) => o.ref.id)).toEqual(['C2-1720000001']);
    await expect(
      plugin.webhookHandler?.handleWebhook({ type: 'ping', payload: {} }),
    ).resolves.toEqual([]);
  });
});
