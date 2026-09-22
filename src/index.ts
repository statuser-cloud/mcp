#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, ConfigError } from './config.js';
import { createServer } from './server.js';

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

  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(
    `[@statuser/mcp] Toolsets enabled: ${[...config.toolsets].join(', ')}\n`,
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
