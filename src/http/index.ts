#!/usr/bin/env node
import { createHttpServer } from './app.js';
import { AuthFailureLimiter } from './auth-failure-limiter.js';

const port = Number(process.env.PORT) || 3000;
// Loopback by default: a container sets HOST=0.0.0.0 explicitly.
const host = process.env.HOST?.trim() || '127.0.0.1';
const apiBaseUrl = process.env.STATUSER_API_URL;
const internalKey = process.env.STATUSER_API_INTERNAL_KEY?.trim() || undefined;
const trustForwardedFor = ['1', 'true', 'yes', 'on'].includes(
  process.env.STATUSER_HTTP_TRUST_FORWARDED_FOR?.trim().toLowerCase() ?? '',
);
// Rejected keys allowed per client address in the window; 0 turns it off.
const authFailureLimit = Number(
  process.env.STATUSER_HTTP_AUTH_FAILURE_LIMIT ?? 30,
);
const AUTH_FAILURE_WINDOW_MS = 10 * 60 * 1000;

const SHUTDOWN_TIMEOUT_MS = 25_000;

const server = createHttpServer({
  apiBaseUrl,
  internalKey,
  trustForwardedFor,
  authFailures: new AuthFailureLimiter(
    Number.isFinite(authFailureLimit) ? authFailureLimit : 30,
    AUTH_FAILURE_WINDOW_MS,
  ),
});

// Node closes idle keep-alive sockets after 5 s. A reverse proxy that reuses
// upstream connections longer than that races the close and answers 502/503.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

server.listen(port, host, () => {
  process.stderr.write(
    `[@statuser/mcp] HTTP transport listening on http://${host}:${port}/\n`,
  );
});

function shutdown(signal: string): void {
  process.stderr.write(`[@statuser/mcp] ${signal} received, draining\n`);
  server.close(() => process.exit(0));
  // Before Node 19 close() waits for idle keep-alive sockets to time out.
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
