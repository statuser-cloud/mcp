import { request } from 'undici';
import { StatuserApiError, type StatuserApiErrorBody } from './errors.js';
import type { ServerConfig } from './config.js';

const USER_AGENT = '@statuser/mcp';
const MAX_429_RETRIES = 2;
const MAX_429_WAIT_SECONDS = 30;

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | string[] | undefined>;
  body?: unknown;
  /**
   * Set to true for endpoints that return non-JSON content (e.g. PDF report).
   * The raw response Buffer is returned instead of parsed JSON.
   */
  binary?: boolean;
}

export interface BinaryResponse {
  contentType: string;
  filename: string | null;
  bytes: Buffer;
}

export class StatuserClient {
  constructor(private readonly config: ServerConfig) {}

  async call<T>(opts: RequestOptions): Promise<T> {
    return (await this.execute(opts)) as T;
  }

  async callBinary(opts: Omit<RequestOptions, 'binary'>): Promise<BinaryResponse> {
    return (await this.execute({ ...opts, binary: true })) as BinaryResponse;
  }

  private async execute(opts: RequestOptions): Promise<unknown> {
    const url = this.buildUrl(opts.path, opts.query);
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.apiKey}`,
      'user-agent': USER_AGENT,
      accept: opts.binary ? '*/*' : 'application/json',
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['content-type'] = 'application/json';
    }

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await request(url, {
        method: opts.method,
        headers,
        body,
      });

      if (res.statusCode === 429 && attempt < MAX_429_RETRIES) {
        const reset = parseRetryAfter(res.headers);
        if (reset !== null && reset <= MAX_429_WAIT_SECONDS) {
          // Drain body before retrying so the connection can be reused.
          await res.body.dump();
          await sleep(reset * 1000);
          attempt += 1;
          continue;
        }
      }

      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (opts.binary) {
          const buf = Buffer.from(await res.body.arrayBuffer());
          return {
            contentType: stringHeader(res.headers, 'content-type') ?? 'application/octet-stream',
            filename: parseFilenameFromContentDisposition(
              stringHeader(res.headers, 'content-disposition'),
            ),
            bytes: buf,
          } satisfies BinaryResponse;
        }
        if (res.statusCode === 204) {
          await res.body.dump();
          return null;
        }
        const text = await res.body.text();
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch {
          // Some endpoints might return text/plain on edge cases.
          return text;
        }
      }

      // Error path — try to parse Statuser-shaped error body.
      const text = await res.body.text();
      let parsed: StatuserApiErrorBody | null = null;
      try {
        parsed = text ? (JSON.parse(text) as StatuserApiErrorBody) : null;
      } catch {
        // ignore
      }
      throw new StatuserApiError(
        res.statusCode,
        parsed?.message ?? text?.slice(0, 500) ?? `HTTP ${res.statusCode}`,
        parsed?.error_code,
        parsed?.meta,
      );
    }
  }

  private buildUrl(
    path: string,
    query: RequestOptions['query'],
  ): string {
    const base = path.startsWith('http')
      ? path
      : `${this.config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    if (!query) return base;
    const url = new URL(base);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.append(key, String(value));
      }
    }
    return url.toString();
  }
}

function stringHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

function parseRetryAfter(
  headers: Record<string, string | string[] | undefined>,
): number | null {
  const reset = stringHeader(headers, 'ratelimit-reset');
  if (reset) {
    const n = Number(reset);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const retry = stringHeader(headers, 'retry-after');
  if (retry) {
    const n = Number(retry);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function parseFilenameFromContentDisposition(
  value: string | undefined,
): string | null {
  if (!value) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(value);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
