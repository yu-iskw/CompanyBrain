import { describe, expect, it } from 'vitest';

import { AuditLog } from './index';

describe('AuditLog', () => {
  it('appends hash-chained events', () => {
    const log = new AuditLog();
    const first = log.append({
      actor: 'alice',
      action: 'search',
      details: { query: 'onboarding' },
    });
    const second = log.append({
      actor: 'alice',
      action: 'get_object',
      resource: 'github:issue:1',
      details: {},
    });
    expect(first.previousHash).toBe('0'.repeat(64));
    expect(second.previousHash).toBe(first.hash);
    expect(log.list()).toHaveLength(2);
    expect(log.verifyIntegrity()).toBe(true);
  });

  it('detects tampering with past events', () => {
    const log = new AuditLog();
    log.append({ actor: 'alice', action: 'search', details: { query: 'salaries' } });
    log.append({ actor: 'alice', action: 'search', details: { query: 'roadmap' } });
    // Simulate an attacker rewriting history on the underlying storage.
    const internal = (log as unknown as { events: Array<{ details: Record<string, string> }> })
      .events;
    internal[0].details = { query: 'weather' };
    expect(log.verifyIntegrity()).toBe(false);
  });

  it('forwards events to registered sinks', () => {
    const log = new AuditLog();
    const seen: string[] = [];
    log.addSink({ write: (event) => seen.push(event.action) });
    log.append({ actor: 'bob', action: 'list_sources', details: {} });
    expect(seen).toEqual(['list_sources']);
  });
});
