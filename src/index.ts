#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, ConfigError } from './config.js';
import { StatuserClient } from './client.js';
import { registerMonitorTools } from './tools/monitors.js';
import { registerIncidentTools } from './tools/incidents.js';
import { registerIncidentCommentTools } from './tools/incident-comments.js';
import { registerStatusPageTools } from './tools/status-pages.js';
import { registerStatusPageReportTools } from './tools/status-page-reports.js';
import { registerNotificationTools } from './tools/notifications.js';
import { registerAccountTools } from './tools/account.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`[@statuser/mcp] ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  const client = new StatuserClient(config);
  const ctx = { client, config };

  const server = new McpServer({
    name: '@statuser/mcp',
    version: '0.1.0',
  });

  const { toolsets } = config;
  if (toolsets.has('account')) registerAccountTools(server, ctx);
  if (toolsets.has('monitors')) registerMonitorTools(server, ctx);
  if (toolsets.has('incidents')) registerIncidentTools(server, ctx);
  if (toolsets.has('incident-comments')) registerIncidentCommentTools(server, ctx);
  if (toolsets.has('status-pages')) registerStatusPageTools(server, ctx);
  if (toolsets.has('status-page-reports')) registerStatusPageReportTools(server, ctx);
  if (toolsets.has('notifications')) registerNotificationTools(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(
    `[@statuser/mcp] Toolsets enabled: ${[...toolsets].join(', ')}\n`,
  );
  if (!config.allowWrite) {
    process.stderr.write(
      '[@statuser/mcp] Write tools are gated: set STATUSER_ALLOW_WRITE=1 to enable destructive operations by default, or pass { confirm: true } per call.\n',
    );
  }
}

main().catch((err) => {
  process.stderr.write(`[@statuser/mcp] fatal: ${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
