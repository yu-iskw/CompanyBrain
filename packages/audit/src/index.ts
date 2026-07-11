/**
 * Immutable audit log.
 *
 * Events are append-only and hash-chained (each event's hash covers its
 * content plus the previous event's hash), so tampering with any past event
 * invalidates the chain. The in-memory implementation backs tests and local
 * runs; production deployments stream the same events to Cloud Logging /
 * BigQuery via the sink interface.
 */
import { createHash, randomUUID } from 'node:crypto';

export interface AuditEventInput {
  /** Acting principal id (delegated user identity). */
  readonly actor: string;
  /** Action name, e.g. "search", "get_object". */
  readonly action: string;
  /** Affected resource key, when applicable. */
  readonly resource?: string;
  /** Structured details (query text, result counts, decisions...). */
  readonly details: Readonly<Record<string, string | number | boolean>>;
}

export interface AuditEvent extends AuditEventInput {
  readonly id: string;
  readonly timestamp: string;
  readonly previousHash: string;
  readonly hash: string;
}

export interface AuditSink {
  write(event: AuditEvent): void;
}

const GENESIS_HASH = '0'.repeat(64);

function computeHash(event: Omit<AuditEvent, 'hash'>): string {
  const payload = JSON.stringify([
    event.id,
    event.timestamp,
    event.actor,
    event.action,
    event.resource ?? '',
    event.details,
    event.previousHash,
  ]);
  return createHash('sha256').update(payload).digest('hex');
}

export class AuditLog {
  private readonly events: AuditEvent[] = [];
  private readonly sinks: AuditSink[] = [];

  addSink(sink: AuditSink): void {
    this.sinks.push(sink);
  }

  append(input: AuditEventInput): AuditEvent {
    const previous = this.events.at(-1);
    const unhashed = {
      ...input,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      previousHash: previous?.hash ?? GENESIS_HASH,
    };
    const event: AuditEvent = { ...unhashed, hash: computeHash(unhashed) };
    this.events.push(event);
    for (const sink of this.sinks) {
      sink.write(event);
    }
    return event;
  }

  list(): readonly AuditEvent[] {
    return [...this.events];
  }

  /** Recomputes the hash chain; false means the log was tampered with. */
  verifyIntegrity(): boolean {
    let previousHash = GENESIS_HASH;
    for (const event of this.events) {
      if (event.previousHash !== previousHash) {
        return false;
      }
      const { hash, ...rest } = event;
      // Chain hashes are public integrity data, not secrets; a timing side
      // channel reveals nothing here.
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (computeHash(rest) !== hash) {
        return false;
      }
      previousHash = hash;
    }
    return true;
  }
}
