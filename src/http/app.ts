import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  buildConfig,
  parseToolsets,
  ConfigError,
  type ServerConfig,
} from '../config.js';
import { StatuserClient } from '../client.js';
import { StatuserApiError } from '../errors.js';
import { createServer } from '../server.js';

const MCP_PATH = '/mcp';
const HEALTH_PATH = '/healthz';

// The SDK transport reads the body without a size cap. Tool arguments are
// small JSON, so 1 MB is generous and keeps a single request from eating memory.
const MAX_BODY_BYTES = 1024 * 1024;

const API_KEYS_URL = 'https://statuser.cloud/my/account/api-keys';

// The key check on initialize must not hold a connecting client hostage to a
// slow API: past this point the client connects and errors surface per call.
const KEY_CHECK_TIMEOUT_MS = 5_000;

export interface HttpServerOptions {
  /** Statuser API base URL the tools call on behalf of the key owner. */
  apiBaseUrl?: string;
  /**
   * Shared secret the API recognises the hosted service by, so it can rate
   * limit per API key rather than per the service's own address. Not an
   * authentication: access is still decided by the caller's key.
   */
  internalKey?: string;
}

/**
 * Stateless Streamable HTTP: every POST builds its own server and transport
 * around the caller's key, so nothing is shared between requests or replicas.
 */
export function createHttpServer(options: HttpServerOptions = {}): http.Server {
  return http.createServer((req, res) => {
    handle(req, res, options).catch((err: unknown) => {
      // Never log the request itself: its Authorization header is a live key.
      process.stderr.write(
        `[@statuser/mcp] request failed: ${String(err instanceof Error ? err.stack : err)}\n`,
      );
      if (!res.headersSent) {
        sendError(res, 500, -32603, 'Internal server error');
      } else {
        res.end();
      }
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  options: HttpServerOptions,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === HEALTH_PATH) {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (url.pathname !== MCP_PATH) {
    sendError(res, 404, -32000, 'Not found');
    return;
  }
  if (req.method !== 'POST') {
    // No sessions: there is no server-initiated stream to open with GET and
    // no session to end with DELETE.
    res.setHeader('allow', 'POST');
    sendError(res, 405, -32000, 'Method not allowed');
    return;
  }

  const apiKey = extractApiKey(req.headers.authorization);
  if (!apiKey) {
    sendUnauthorized(
      res,
      `Missing or malformed API key. Send "Authorization: Bearer <key>"; create a key at ${API_KEYS_URL}`,
    );
    return;
  }

  let toolsets;
  try {
    toolsets = parseToolsets(
      url.searchParams.get('toolsets') ?? undefined,
      'The "toolsets" query parameter',
    );
  } catch (err) {
    if (err instanceof ConfigError) {
      sendError(res, 400, -32602, err.message);
      return;
    }
    throw err;
  }

  const body = await readJsonBody(req);
  if (!body.ok) {
    sendError(res, body.status, body.code, body.message);
    return;
  }

  const config = buildConfig({
    apiKey,
    baseUrl: options.apiBaseUrl,
    toolsets,
    apiHeaders: upstreamHeaders(req, options),
  });

  // Once per client connection, not per call: stateless mode has no session to
  // remember the verdict in, and initialize is the one request every client
  // sends first. Without it a wrong key "connects" and fails on the first tool.
  if (isInitialize(body.value) && (await isKeyRejected(config))) {
    sendUnauthorized(
      res,
      `The API key is invalid, expired or revoked. Create a new one at ${API_KEYS_URL}`,
    );
    return;
  }

  const server = createServer(config, 'http');
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, body.value);
}

function extractApiKey(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  const token = match?.[1];
  // Only the shape is checked here; the API validates the key itself.
  return token?.startsWith('sk_') ? token : null;
}

/**
 * The API records the client address in the audit log. Forward the chain the
 * proxy in front of us passed, plus our own peer, as any proxy would —
 * otherwise every action would be logged from our address.
 */
function upstreamHeaders(
  req: IncomingMessage,
  options: HttpServerOptions,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const chain = [req.headers['x-forwarded-for'], req.socket.remoteAddress]
    .flat()
    .filter((v): v is string => Boolean(v))
    .join(', ');
  if (chain) headers['x-forwarded-for'] = chain;
  if (options.internalKey) headers['x-mcp-internal-key'] = options.internalKey;
  return headers;
}

function isInitialize(message: unknown): boolean {
  const messages = Array.isArray(message) ? message : [message];
  return messages.some(
    (m) =>
      typeof m === 'object' &&
      m !== null &&
      (m as { method?: unknown }).method === 'initialize',
  );
}

/**
 * Only a definite 401 rejects. An unreachable or slow API lets the client
 * connect: telling someone their key is wrong because of our outage would
 * send them to rotate a key that works.
 */
async function isKeyRejected(config: ServerConfig): Promise<boolean> {
  const check = new StatuserClient(config)
    .call({ method: 'GET', path: '/v1/account' })
    .then(
      () => false,
      (err: unknown) => err instanceof StatuserApiError && err.status === 401,
    );
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), KEY_CHECK_TIMEOUT_MS).unref();
  });
  return Promise.race([check, timeout]);
}

type BodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: number; code: number; message: string };

async function readJsonBody(req: IncomingMessage): Promise<BodyResult> {
  const tooLarge: BodyResult = {
    ok: false,
    status: 413,
    code: -32600,
    message: `Request body exceeds ${MAX_BODY_BYTES} bytes`,
  };
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
    return tooLarge;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return tooLarge;
    chunks.push(chunk as Buffer);
  }

  try {
    return {
      ok: true,
      value: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    };
  } catch {
    return {
      ok: false,
      status: 400,
      code: -32700,
      message: 'Parse error: Invalid JSON',
    };
  }
}

function sendUnauthorized(res: ServerResponse, message: string): void {
  res.setHeader('www-authenticate', 'Bearer realm="statuser"');
  sendError(res, 401, -32001, message);
}

function sendError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  res
    .writeHead(status, { 'content-type': 'application/json' })
    .end(
      JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }),
    );
}
