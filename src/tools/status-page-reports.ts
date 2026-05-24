import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from '../tool.js';
import type { OkResponseBody, RequestBody } from '../generated/helpers.js';

type IncidentReportPublishBody = RequestBody<
  '/v1/status-pages/{id}/incident-reports',
  'post'
>;
type IncidentReportUpdateBody = RequestBody<
  '/v1/status-pages/{id}/incident-reports/{reportId}',
  'patch'
>;
type IncidentReportUpdateAddBody = RequestBody<
  '/v1/status-pages/{id}/incident-reports/{reportId}/updates',
  'post'
>;
type IncidentReportUpdateEditBody = RequestBody<
  '/v1/status-pages/{id}/incident-reports/{reportId}/updates/{updateId}',
  'patch'
>;
type MaintenanceScheduleBody = RequestBody<
  '/v1/status-pages/{id}/planned-maintenances',
  'post'
>;
type MaintenanceUpdateBody = RequestBody<
  '/v1/status-pages/{id}/planned-maintenances/{maintenanceId}',
  'patch'
>;
type MaintenanceUpdateAddBody = RequestBody<
  '/v1/status-pages/{id}/planned-maintenances/{maintenanceId}/updates',
  'post'
>;
type MaintenanceUpdateEditBody = RequestBody<
  '/v1/status-pages/{id}/planned-maintenances/{maintenanceId}/updates/{updateId}',
  'patch'
>;

type IncidentReportListResponse = OkResponseBody<
  '/v1/status-pages/{id}/incident-reports',
  'get'
>;
type IncidentReportPublishResponse = OkResponseBody<
  '/v1/status-pages/{id}/incident-reports',
  'post'
>;
type IncidentReportUpdateResponse = OkResponseBody<
  '/v1/status-pages/{id}/incident-reports/{reportId}',
  'patch'
>;
type IncidentReportUpdateAddResponse = OkResponseBody<
  '/v1/status-pages/{id}/incident-reports/{reportId}/updates',
  'post'
>;
type IncidentReportUpdateEditResponse = OkResponseBody<
  '/v1/status-pages/{id}/incident-reports/{reportId}/updates/{updateId}',
  'patch'
>;
type MaintenanceListResponse = OkResponseBody<
  '/v1/status-pages/{id}/planned-maintenances',
  'get'
>;
type MaintenanceScheduleResponse = OkResponseBody<
  '/v1/status-pages/{id}/planned-maintenances',
  'post'
>;
type MaintenanceUpdateResponse = OkResponseBody<
  '/v1/status-pages/{id}/planned-maintenances/{maintenanceId}',
  'patch'
>;
type MaintenanceUpdateAddResponse = OkResponseBody<
  '/v1/status-pages/{id}/planned-maintenances/{maintenanceId}/updates',
  'post'
>;
type MaintenanceUpdateEditResponse = OkResponseBody<
  '/v1/status-pages/{id}/planned-maintenances/{maintenanceId}/updates/{updateId}',
  'patch'
>;

const affectStatusEnum = z
  .enum(['not_affected', 'downtime', 'degraded', 'resolved'])
  .describe(
    'Per-server impact during the report/update: `not_affected`, `downtime`, `degraded` or `resolved`.',
  );

const reportServerSchema = z.object({
  server_id: z
    .number()
    .int()
    .positive()
    .describe('Status-page server id (from `status_page_get`).'),
  status: affectStatusEnum,
});

const maintenanceServerSchema = z.object({
  id: z
    .number()
    .int()
    .positive()
    .describe('Status-page server id (from `status_page_get`).'),
});

export function registerStatusPageReportTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  // ---------- Incident reports ----------

  registerTool(server, ctx, {
    name: 'status_page_incident_report_list',
    title: 'List incident reports for a status page',
    description:
      'Lists incident reports published on a status page with their title, linked monitors, per-server affect statuses and the timeline of updates.',
    inputSchema: {
      status_page_id: z.number().int().positive(),
    },
    handler: async ({ status_page_id }, { client }) =>
      client.call<IncidentReportListResponse>({
        method: 'GET',
        path: `/v1/status-pages/${status_page_id}/incident-reports`,
      }),
  });

  registerTool(server, ctx, {
    name: 'status_page_incident_report_publish',
    title: 'Publish a new incident report',
    description:
      'Publishes a new incident report on a status page: title, initial timeline message, start time and per-server impact (`servers`). Optionally link to existing Statuser incidents via `incident_ids` so the report aggregates their data. Add subsequent timeline updates via `status_page_incident_report_update_add`. Monthly quota: `status_page_incident_reports_per_month_limit` — 403 on overflow.',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      title: z.string().min(3).max(255),
      initial_message: z
        .string()
        .min(1)
        .describe('Text of the initial timeline update.'),
      started_at: z
        .string()
        .describe('ISO 8601 timestamp when the incident started.'),
      servers: z
        .array(reportServerSchema)
        .describe(
          'Per-server impact at the moment the report is published. Use `status_page_get` to find status-page server ids.',
        ),
      incident_ids: z
        .array(z.number().int().positive())
        .optional()
        .describe(
          'Statuser incidents to link to this report (optional). If set, the report is based on these existing incidents.',
        ),
    },
    handler: async (
      {
        status_page_id,
        title,
        initial_message,
        started_at,
        servers,
        incident_ids,
      },
      { client },
    ) => {
      const body: IncidentReportPublishBody = {
        title,
        initial_message,
        started_at,
        servers,
        incident_ids,
      };
      return client.call<IncidentReportPublishResponse>({
        method: 'POST',
        path: `/v1/status-pages/${status_page_id}/incident-reports`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_incident_report_update',
    title: 'Edit incident report fields',
    description:
      'Edits the report itself: `title` and/or `started_at`. To change per-server impact or post a new message, use `status_page_incident_report_update_add`.',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      report_id: z.number().int().positive(),
      title: z.string().min(3).max(255).optional(),
      started_at: z.string().optional(),
    },
    handler: async (
      { status_page_id, report_id, ...patch },
      { client },
    ) => {
      const body: IncidentReportUpdateBody = patch;
      return client.call<IncidentReportUpdateResponse>({
        method: 'PATCH',
        path: `/v1/status-pages/${status_page_id}/incident-reports/${report_id}`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_incident_report_update_add',
    title: 'Add timeline update to incident report',
    description:
      'Appends a new timeline message to the incident report and updates per-server impact (`servers`). Each call adds a separate record with its own timestamp. If `published_at` is set, it must not be in the future and not earlier than the report start — otherwise 400.',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      report_id: z.number().int().positive(),
      message: z.string().min(1),
      servers: z
        .array(reportServerSchema)
        .describe('New per-server impact statuses delivered with this update.'),
      published_at: z
        .string()
        .optional()
        .describe('ISO 8601. Defaults to "now" on the server side.'),
    },
    handler: async (
      { status_page_id, report_id, ...rest },
      { client },
    ) => {
      const body: IncidentReportUpdateAddBody = rest;
      return client.call<IncidentReportUpdateAddResponse>({
        method: 'POST',
        path: `/v1/status-pages/${status_page_id}/incident-reports/${report_id}/updates`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_incident_report_update_edit',
    title: 'Edit a timeline update in an incident report',
    description:
      'Edits the text of a previously published timeline message (`message` only). Other fields of the update (timestamp, per-server status) cannot be changed.',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      report_id: z.number().int().positive(),
      update_id: z.number().int().positive(),
      message: z.string().min(1),
    },
    handler: async (
      { status_page_id, report_id, update_id, message },
      { client },
    ) => {
      const body: IncidentReportUpdateEditBody = { message };
      return client.call<IncidentReportUpdateEditResponse>({
        method: 'PATCH',
        path: `/v1/status-pages/${status_page_id}/incident-reports/${report_id}/updates/${update_id}`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_incident_report_update_delete',
    title: 'Delete a timeline update from incident report',
    description:
      'Removes one timeline message from a report by `update_id`. The report itself and the other messages stay. The initial update (created with the report) cannot be deleted — attempt returns 400; delete the whole report instead.',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      report_id: z.number().int().positive(),
      update_id: z.number().int().positive(),
    },
    handler: async (
      { status_page_id, report_id, update_id },
      { client },
    ) => {
      await client.call({
        method: 'DELETE',
        path: `/v1/status-pages/${status_page_id}/incident-reports/${report_id}/updates/${update_id}`,
      });
      return { deleted: true, update_id };
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_incident_report_delete',
    title: 'Delete incident report from status page',
    description:
      'Removes the incident report from a status page with all its updates. Irreversible. Underlying monitors and incidents in Statuser are not affected — only the public publication is removed.',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      report_id: z.number().int().positive(),
    },
    handler: async ({ status_page_id, report_id }, { client }) => {
      await client.call({
        method: 'DELETE',
        path: `/v1/status-pages/${status_page_id}/incident-reports/${report_id}`,
      });
      return { deleted: true, report_id };
    },
  });

  // ---------- Planned maintenances ----------

  registerTool(server, ctx, {
    name: 'status_page_maintenance_list',
    title: 'List planned maintenances for a status page',
    description:
      'Lists planned maintenances published on a status page: title, description, start/end window, affected monitors and timeline of updates. Includes upcoming and completed entries — filter by time on the client side.',
    inputSchema: {
      status_page_id: z.number().int().positive(),
    },
    handler: async ({ status_page_id }, { client }) =>
      client.call<MaintenanceListResponse>({
        method: 'GET',
        path: `/v1/status-pages/${status_page_id}/planned-maintenances`,
      }),
  });

  registerTool(server, ctx, {
    name: 'status_page_maintenance_schedule',
    title: 'Schedule planned maintenance',
    description:
      'Announces a planned maintenance window on a status page. All fields are required: `title`, `description`, `started_at`, `ended_at` and the list of `servers` (`{ id }[]`). Monthly quota: `status_page_planned_maintenances_per_month_limit` — 403 on overflow.',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      title: z.string().min(3).max(255),
      description: z.string().min(1),
      started_at: z.string().describe('ISO 8601 start time.'),
      ended_at: z.string().describe('ISO 8601 end time.'),
      servers: z
        .array(maintenanceServerSchema)
        .describe(
          'Status-page servers affected by the maintenance. Use `status_page_get` to find ids.',
        ),
    },
    handler: async ({ status_page_id, ...rest }, { client }) => {
      const body: MaintenanceScheduleBody = rest;
      return client.call<MaintenanceScheduleResponse>({
        method: 'POST',
        path: `/v1/status-pages/${status_page_id}/planned-maintenances`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_maintenance_update',
    title: 'Edit planned maintenance fields',
    description:
      'Edits the maintenance entry itself: title, description, time window, list of affected servers. This does not append a timeline message — use `status_page_maintenance_update_add` for progress updates.',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      maintenance_id: z.number().int().positive(),
      title: z.string().min(3).max(255).optional(),
      description: z.string().min(1).optional(),
      started_at: z.string().optional(),
      ended_at: z.string().optional(),
      servers: z.array(maintenanceServerSchema).optional(),
    },
    handler: async (
      { status_page_id, maintenance_id, ...patch },
      { client },
    ) => {
      const body: MaintenanceUpdateBody = patch;
      return client.call<MaintenanceUpdateResponse>({
        method: 'PATCH',
        path: `/v1/status-pages/${status_page_id}/planned-maintenances/${maintenance_id}`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_maintenance_update_add',
    title: 'Add timeline update to planned maintenance',
    description:
      'Appends a new message to the maintenance timeline ("started", "in progress", "completed", "postponed"). If `published_at` is omitted, the server stamps "now".',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      maintenance_id: z.number().int().positive(),
      message: z.string().min(1),
      published_at: z.string().optional(),
    },
    handler: async (
      { status_page_id, maintenance_id, ...rest },
      { client },
    ) => {
      const body: MaintenanceUpdateAddBody = rest;
      return client.call<MaintenanceUpdateAddResponse>({
        method: 'POST',
        path: `/v1/status-pages/${status_page_id}/planned-maintenances/${maintenance_id}/updates`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_maintenance_update_edit',
    title: 'Edit a timeline update in planned maintenance',
    description:
      'Edits the text of a previously published maintenance timeline message (`message` only).',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      maintenance_id: z.number().int().positive(),
      update_id: z.number().int().positive(),
      message: z.string().min(1),
    },
    handler: async (
      { status_page_id, maintenance_id, update_id, message },
      { client },
    ) => {
      const body: MaintenanceUpdateEditBody = { message };
      return client.call<MaintenanceUpdateEditResponse>({
        method: 'PATCH',
        path: `/v1/status-pages/${status_page_id}/planned-maintenances/${maintenance_id}/updates/${update_id}`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_maintenance_update_delete',
    title: 'Delete a timeline update from planned maintenance',
    description:
      'Removes one timeline message from a planned maintenance by `update_id`. The entry itself and the other messages stay. The initial update (created with the entry) cannot be deleted — attempt returns 400; delete the whole entry instead.',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      maintenance_id: z.number().int().positive(),
      update_id: z.number().int().positive(),
    },
    handler: async (
      { status_page_id, maintenance_id, update_id },
      { client },
    ) => {
      await client.call({
        method: 'DELETE',
        path: `/v1/status-pages/${status_page_id}/planned-maintenances/${maintenance_id}/updates/${update_id}`,
      });
      return { deleted: true, update_id };
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_maintenance_delete',
    title: 'Delete planned maintenance from status page',
    description:
      'Removes a planned maintenance entry from a status page with all its updates. Irreversible. If a maintenance is just cancelled, publishing a "cancelled" timeline update is usually preferable — otherwise users will not see the history.',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      maintenance_id: z.number().int().positive(),
    },
    handler: async (
      { status_page_id, maintenance_id },
      { client },
    ) => {
      await client.call({
        method: 'DELETE',
        path: `/v1/status-pages/${status_page_id}/planned-maintenances/${maintenance_id}`,
      });
      return { deleted: true, maintenance_id };
    },
  });
}
