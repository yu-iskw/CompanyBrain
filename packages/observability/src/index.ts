/**
 * Structured logging and metrics. Log lines are single-line JSON so Cloud
 * Logging picks up severity and fields without a custom agent.
 */

export type LogFields = Readonly<Record<string, string | number | boolean>>;

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export function createConsoleLogger(
  component: string,
  write: (line: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  },
): Logger {
  const emit = (severity: string, message: string, fields?: LogFields): void => {
    write(
      JSON.stringify({
        severity,
        component,
        message,
        timestamp: new Date().toISOString(),
        ...fields,
      }),
    );
  };
  return {
    info: (message, fields) => emit('INFO', message, fields),
    warn: (message, fields) => emit('WARNING', message, fields),
    error: (message, fields) => emit('ERROR', message, fields),
  };
}

/** Minimal counter registry, exportable to Cloud Monitoring. */
export class MetricsRegistry {
  private readonly counters = new Map<string, number>();

  increment(name: string, delta = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + delta);
  }

  value(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  snapshot(): ReadonlyMap<string, number> {
    return new Map(this.counters);
  }
}
