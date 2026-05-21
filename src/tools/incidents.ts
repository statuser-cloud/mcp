import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from '../tool.js';

const incidentStatusEnum = z.enum([
  'ongoing',
  'resolved',
  'dismissed',
  'auto_closed_changed',
  'auto_closed_timeout',
]);

const reportSection = z.enum([
  'ai_summary',
  'diagnostics',
  'technical_reference',
  'events',
]);

export function registerIncidentTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerTool(server, ctx, {
    name: 'incident_list',
    title: 'List incidents',
    description:
      'Lists incidents. Without `server_id` — across the whole account, sorted by start time desc; with `server_id` — only that monitor. `status` filter applies only to the account-wide form. Time depth is limited by the `incident_retention_days` plan feature.',
    inputSchema: {
      server_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Limit to one monitor. If set, `status` filter is ignored.'),
      status: incidentStatusEnum.optional(),
    },
    handler: async ({ server_id, status }, { client }) => {
      if (server_id !== undefined) {
        return client.call({
          method: 'GET',
          path: `/v1/servers/${server_id}/incidents`,
        });
      }
      return client.call({
        method: 'GET',
        path: '/v1/incidents',
        query: { status },
      });
    },
  });

  registerTool(server, ctx, {
    name: 'incident_get',
    title: 'Get incident',
    description:
      'Returns a detailed incident card: status, start/end time, root cause, keyword, replay link, plus screenshot and per-location network diagnostics (headers, body, OpenSSL, ping/nmap/mtr/traceroute, timings). `screenshot` is only returned when `screenshots_enabled` is on the plan; `details` — only when `network_diagnostics_enabled`.',
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) =>
      client.call({ method: 'GET', path: `/v1/incidents/${id}` }),
  });

  registerTool(server, ctx, {
    name: 'incident_get_events',
    title: 'Get incident event timeline',
    description:
      'Returns the chronological event log of an incident: status changes, notifications sent (email/Telegram/MAX/webhooks), confirmations, auto-recoveries, etc. Useful for audits and timeline rendering.',
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) =>
      client.call({ method: 'GET', path: `/v1/incidents/${id}/events` }),
  });

  registerTool(server, ctx, {
    name: 'incident_get_server',
    title: 'Get monitor by incident',
    description:
      'Shortcut: returns the monitor linked to a given incident in one call.',
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) =>
      client.call({ method: 'GET', path: `/v1/incidents/${id}/server` }),
  });

  registerTool(server, ctx, {
    name: 'incident_generate_ai_summary',
    title: 'Generate AI summary for incident',
    description:
      'Generates (or returns the cached) AI summary of the incident — a short human-readable explanation of what happened and why, based on diagnostics. Idempotent: repeated calls return the same summary. Requires `network_diagnostics_enabled` on the plan.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) =>
      client.call({
        method: 'POST',
        path: `/v1/incidents/${id}/ai-summary`,
      }),
  });

  registerTool(server, ctx, {
    name: 'incident_rate_ai_summary',
    title: 'Rate AI summary',
    description:
      'Submits feedback on the AI summary: `positive` or `negative`. Pass `rating: null` to clear a previously set rating.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
      rating: z.enum(['positive', 'negative']).nullable(),
    },
    handler: async ({ id, rating }, { client }) =>
      client.call({
        method: 'POST',
        path: `/v1/incidents/${id}/ai-summary/rating`,
        body: { rating },
      }),
  });

  registerTool(server, ctx, {
    name: 'incident_get_report_pdf',
    title: 'Download incident PDF report',
    description:
      'Downloads a ready-to-attach PDF report for the incident. Returns metadata plus the base64-encoded file. Section composition is controlled by `sections` (`ai_summary`, `diagnostics`, `technical_reference`, `events`). Requires `incident_report_enabled` on the plan — otherwise 403.',
    inputSchema: {
      id: z.number().int().positive(),
      sections: z
        .array(reportSection)
        .optional()
        .describe('Which sections to include. Defaults to all on the server side.'),
    },
    handler: async ({ id, sections }, { client }) => {
      const res = await client.callBinary({
        method: 'GET',
        path: `/v1/incidents/${id}/report`,
        query: { sections },
      });
      return {
        filename: res.filename ?? `incident-${id}.pdf`,
        content_type: res.contentType,
        size_bytes: res.bytes.byteLength,
        pdf_base64: res.bytes.toString('base64'),
      };
    },
  });
}
