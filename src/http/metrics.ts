/**
 * Prometheus metrics for the hosted endpoint, in the text exposition format.
 * Hand-rolled on purpose: the npm package ships to every `npx` user, and a
 * few counters and one histogram do not justify a dependency there.
 *
 * Label values stay low-cardinality: tool names and outcomes are a closed set,
 * HTTP statuses are few, and client names are capped (see `clientLabel`).
 */

import type { ToolOutcome } from '../tool.js';

type Labels = Record<string, string>;

const escape = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

const labelKey = (labels: Labels) =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}="${escape(labels[k] ?? '')}"`)
    .join(',');

class Counter {
  private readonly values = new Map<string, number>();

  constructor(
    readonly name: string,
    private readonly help: string,
  ) {}

  inc(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  render(): string {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];
    for (const [key, value] of this.values) {
      lines.push(`${this.name}${key ? `{${key}}` : ''} ${value}`);
    }
    return lines.join('\n');
  }
}

class Histogram {
  private readonly series = new Map<
    string,
    { buckets: number[]; sum: number; count: number }
  >();

  constructor(
    readonly name: string,
    private readonly help: string,
    private readonly bounds: readonly number[],
  ) {}

  observe(labels: Labels, value: number): void {
    const key = labelKey(labels);
    let s = this.series.get(key);
    if (!s) {
      s = { buckets: this.bounds.map(() => 0), sum: 0, count: 0 };
      this.series.set(key, s);
    }
    this.bounds.forEach((bound, i) => {
      if (value <= bound) s.buckets[i] = (s.buckets[i] ?? 0) + 1;
    });
    s.sum += value;
    s.count += 1;
  }

  render(): string {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];
    for (const [key, s] of this.series) {
      const prefix = key ? `${key},` : '';
      this.bounds.forEach((bound, i) => {
        lines.push(
          `${this.name}_bucket{${prefix}le="${bound}"} ${s.buckets[i]}`,
        );
      });
      lines.push(`${this.name}_bucket{${prefix}le="+Inf"} ${s.count}`);
      const plain = key ? `{${key}}` : '';
      lines.push(`${this.name}_sum${plain} ${s.sum}`);
      lines.push(`${this.name}_count${plain} ${s.count}`);
    }
    return lines.join('\n');
  }
}

export type AuthRejection = 'missing_key' | 'invalid_key' | 'blocked';

// Client names come from the caller, so they are normalised and capped:
// past this many distinct names everything new is counted as `other`.
const MAX_CLIENT_LABELS = 50;

export class HttpMetrics {
  private readonly httpRequests = new Counter(
    'statuser_mcp_http_requests_total',
    'HTTP responses by status code.',
  );
  private readonly toolCalls = new Counter(
    'statuser_mcp_tool_calls_total',
    'Tool calls by tool and outcome.',
  );
  private readonly toolDuration = new Histogram(
    'statuser_mcp_tool_call_duration_seconds',
    'Tool call duration, including the Statuser API round trip.',
    [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  );
  private readonly authRejections = new Counter(
    'statuser_mcp_auth_rejections_total',
    'Requests refused before reaching the tools, by reason.',
  );
  private readonly sessions = new Counter(
    'statuser_mcp_client_sessions_total',
    'initialize requests by client name.',
  );
  private readonly knownClients = new Set<string>();

  constructor(private readonly version: string) {}

  httpResponse(status: number): void {
    this.httpRequests.inc({ status: String(status) });
  }

  toolCall(tool: string, outcome: ToolOutcome, seconds: number): void {
    this.toolCalls.inc({ tool, outcome });
    this.toolDuration.observe({ tool }, seconds);
  }

  authRejected(reason: AuthRejection): void {
    this.authRejections.inc({ reason });
  }

  clientSession(name: unknown): void {
    this.sessions.inc({ client: this.clientLabel(name) });
  }

  render(): string {
    return (
      [
        `# HELP statuser_mcp_build_info Build version of the running server.`,
        `# TYPE statuser_mcp_build_info gauge`,
        `statuser_mcp_build_info{version="${escape(this.version)}"} 1`,
        this.httpRequests.render(),
        this.toolCalls.render(),
        this.toolDuration.render(),
        this.authRejections.render(),
        this.sessions.render(),
      ].join('\n') + '\n'
    );
  }

  private clientLabel(name: unknown): string {
    if (typeof name !== 'string') return 'unknown';
    const label = name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    if (!label) return 'unknown';
    if (this.knownClients.has(label)) return label;
    if (this.knownClients.size >= MAX_CLIENT_LABELS) return 'other';
    this.knownClients.add(label);
    return label;
  }
}
