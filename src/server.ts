import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerConfig } from './config.js';
import type { TransportKind } from './tool.js';
import { StatuserClient } from './client.js';
import { registerMonitorTools } from './tools/monitors.js';
import { registerIncidentTools } from './tools/incidents.js';
import { registerIncidentCommentTools } from './tools/incident-comments.js';
import { registerStatusPageTools } from './tools/status-pages.js';
import { registerStatusPageReportTools } from './tools/status-page-reports.js';
import { registerStatusPageAnnouncementTools } from './tools/status-page-announcements.js';
import { registerStatusPageSubscriberTools } from './tools/status-page-subscribers.js';
import { registerNotificationTools } from './tools/notifications.js';
import { registerAccountTools } from './tools/account.js';
import { registerProjectTools } from './tools/projects.js';

// Read at runtime rather than imported: package.json sits outside rootDir.
// The path resolves the same from src/ (tsx) and dist/ (published build).
const { version } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

/**
 * Builds a server with every enabled toolset registered. Shared by the stdio
 * and HTTP entrypoints — the transport is the only thing that differs.
 */
export function createServer(
  config: ServerConfig,
  transport: TransportKind = 'stdio',
): McpServer {
  const client = new StatuserClient(config);
  const ctx = { client, config, transport };

  const server = new McpServer({ name: '@statuser/mcp', version });

  const { toolsets } = config;
  if (toolsets.has('account')) registerAccountTools(server, ctx);
  if (toolsets.has('projects')) registerProjectTools(server, ctx);
  if (toolsets.has('monitors')) registerMonitorTools(server, ctx);
  if (toolsets.has('incidents')) registerIncidentTools(server, ctx);
  if (toolsets.has('incident-comments'))
    registerIncidentCommentTools(server, ctx);
  if (toolsets.has('status-pages')) {
    registerStatusPageTools(server, ctx);
    registerStatusPageSubscriberTools(server, ctx);
  }
  if (toolsets.has('status-page-reports')) {
    registerStatusPageReportTools(server, ctx);
    registerStatusPageAnnouncementTools(server, ctx);
  }
  if (toolsets.has('notifications')) registerNotificationTools(server, ctx);

  return server;
}
