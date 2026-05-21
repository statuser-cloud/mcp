import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from '../tool.js';

// Mirrors the public enum from PlanFeaturesResponseDto / ServerProtocol.
const protocolEnum = z.enum([
  'ping',
  'http',
  'keyword',
  'tcp',
  'dns',
  'heartbeat',
]);

const headerSchema = z.object({
  key: z.string(),
  value: z.string(),
});

const baseMonitorFields = {
  host: z
    .string()
    .describe(
      'Host to monitor: URL for http/keyword, hostname or IP for ping/tcp/dns, identifier for heartbeat.',
    ),
  protocol: protocolEnum.describe(
    'Monitor type. SSL/domain checks are flags layered on top of `http`.',
  ),
  port: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .optional()
    .describe('Required for `tcp`.'),
  http_method: z
    .enum(['get', 'head', 'post', 'put', 'patch', 'options'])
    .optional()
    .describe('HTTP method, applies to `http` and `keyword` protocols.'),
  body: z
    .string()
    .nullable()
    .optional()
    .describe('Request body for `http`/`keyword`.'),
  keyword: z
    .string()
    .max(256)
    .nullable()
    .optional()
    .describe('Substring to look for on the page (for `keyword` protocol).'),
  keyword_mode: z
    .enum(['present', 'absent'])
    .nullable()
    .optional()
    .describe('Whether the keyword should be present or absent.'),
  headers: z.array(headerSchema).optional(),
  is_follow_redirects: z.boolean().optional(),
  success_http_codes: z
    .array(z.string())
    .optional()
    .describe(
      'HTTP codes considered successful. Accepts exact codes (200, 301) and masks (2xx, 5xx).',
    ),
  request_timeout: z.number().int().min(1).max(60).optional(),
  check_interval: z
    .number()
    .int()
    .min(60)
    .optional()
    .describe(
      'Interval between checks in seconds. Minimum depends on `min_check_interval_seconds` of the current plan.',
    ),
  heartbeat_grace_interval: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe(
      'Additional grace period (in seconds) past `check_interval` for `heartbeat` monitors.',
    ),
  name: z.string().max(150).optional(),
  description: z.string().max(500).optional(),
  is_ssl_check: z.boolean().optional(),
  is_domain_check: z.boolean().optional(),
  is_latency_alert_enabled: z.boolean().optional(),
  latency_trigger_ms: z.number().int().min(50).max(60000).optional(),
  locations: z
    .array(z.string())
    .optional()
    .describe(
      'Locations to run checks from. Allowed values are the codes from `current_plan_get` -> `features.available_locations`.',
    ),
  dns_record_types: z
    .array(z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'PTR', 'SRV']))
    .optional()
    .describe('Required for `dns` protocol.'),
};

export function registerMonitorTools(server: McpServer, ctx: ToolContext): void {
  registerTool(server, ctx, {
    name: 'monitor_list',
    title: 'List monitors',
    description:
      'Lists every monitor on the account with current status and configuration. Use `limit`/`offset` to paginate — recommended for accounts with many monitors.',
    inputSchema: {
      limit: z.number().int().min(1).optional(),
      offset: z.number().int().min(0).optional(),
    },
    handler: async ({ limit, offset }, { client }) =>
      client.call({
        method: 'GET',
        path: '/v1/servers',
        query: { limit, offset },
      }),
  });

  registerTool(server, ctx, {
    name: 'monitor_get',
    title: 'Get monitor',
    description:
      'Returns full configuration and latest status for one monitor by id.',
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) =>
      client.call({ method: 'GET', path: `/v1/servers/${id}` }),
  });

  registerTool(server, ctx, {
    name: 'monitor_create',
    title: 'Create monitor',
    description:
      'Creates a new monitor. Returns 403 if the account is over the servers limit or if a requested feature is not on the current plan (DNS/keyword/heartbeat, latency alerts, custom success codes, non-default locations).',
    write: true,
    inputSchema: baseMonitorFields,
    handler: async (args, { client }) =>
      client.call({ method: 'POST', path: '/v1/servers', body: args }),
  });

  registerTool(server, ctx, {
    name: 'monitor_update',
    title: 'Update monitor',
    description:
      'Partial update: pass only the fields you want to change. Plan-feature constraints from `monitor_create` apply on update too.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
      ...Object.fromEntries(
        Object.entries(baseMonitorFields).map(([k, v]) => [
          k,
          (v as z.ZodTypeAny).optional(),
        ]),
      ),
    },
    handler: async ({ id, ...patch }, { client }) =>
      client.call({
        method: 'PATCH',
        path: `/v1/servers/${id}`,
        body: patch,
      }),
  });

  registerTool(server, ctx, {
    name: 'monitor_pause',
    title: 'Pause or resume monitor',
    description:
      'Pauses (`action = "pause"`) or resumes (`action = "unpause"`) checks for a monitor without deleting its configuration or history. On resume, plan-feature gating is re-evaluated.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
      action: z.enum(['pause', 'unpause']),
    },
    handler: async ({ id, action }, { client }) =>
      client.call({ method: 'PATCH', path: `/v1/servers/${id}/${action}` }),
  });

  registerTool(server, ctx, {
    name: 'monitor_delete',
    title: 'Delete monitor',
    description:
      'Permanently deletes a monitor with its history, incidents and alert settings. Irreversible. To pause checks temporarily, use `monitor_pause` instead.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) => {
      await client.call({ method: 'DELETE', path: `/v1/servers/${id}` });
      return { deleted: true, id };
    },
  });

  registerTool(server, ctx, {
    name: 'monitor_test_notify',
    title: 'Send test notification for monitor',
    description:
      'Fires a test notification through all channels configured for this account (email/Telegram/MAX per notification rules + webhooks subscribed to the matching type). Useful for verifying delivery without waiting for a real incident.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) => {
      await client.call({
        method: 'POST',
        path: `/v1/servers/${id}/test-notify`,
      });
      return { sent: true, id };
    },
  });

  registerTool(server, ctx, {
    name: 'monitor_get_checks',
    title: 'Get monitor checks (aggregated)',
    description:
      'Returns aggregated check results for the period, suitable for uptime/latency graphs. Defaults to the last 24h if `start_date`/`end_date` are omitted. For day-scale periods, the response also contains the last few raw points to keep the graph interactive between aggregation intervals.',
    inputSchema: {
      id: z.number().int().positive(),
      start_date: z
        .string()
        .optional()
        .describe('ISO 8601 timestamp (inclusive). Default: now - 24h.'),
      end_date: z
        .string()
        .optional()
        .describe('ISO 8601 timestamp (exclusive). Default: now.'),
    },
    handler: async ({ id, start_date, end_date }, { client }) =>
      client.call({
        method: 'GET',
        path: `/v1/servers/${id}/checks`,
        query: { startDate: start_date, endDate: end_date },
      }),
  });

  registerTool(server, ctx, {
    name: 'monitor_get_heartbeat_events',
    title: 'Get heartbeat events',
    description:
      'Returns heartbeat events (pings from an external system) aggregated into equal intervals over the period. Only meaningful for monitors with `protocol = "heartbeat"`; others return an empty array. Defaults to the last 24h.',
    inputSchema: {
      id: z.number().int().positive(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
    },
    handler: async ({ id, start_date, end_date }, { client }) =>
      client.call({
        method: 'GET',
        path: `/v1/servers/${id}/heartbeat/events`,
        query: { startDate: start_date, endDate: end_date },
      }),
  });

  registerTool(server, ctx, {
    name: 'monitor_get_dns_history',
    title: 'Get DNS-record history',
    description:
      'Returns diffs of DNS records observed by the monitor: what was added, what was removed, per record type. History depth is limited by the `dns_history_retention_days` plan feature. Only populated for monitors with `protocol = "dns"`; others return an empty array.',
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) =>
      client.call({ method: 'GET', path: `/v1/servers/${id}/dns-history` }),
  });
}
