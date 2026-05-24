import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from '../tool.js';
import type { OkResponseBody, RequestBody } from '../generated/helpers.js';

type StatusPageCreateBody = RequestBody<'/v1/status-pages', 'post'>;
type StatusPageUpdateBody = RequestBody<'/v1/status-pages/{id}', 'patch'>;
type StatusPageSetGroupsBody = RequestBody<
  '/v1/status-pages/{id}/servers',
  'patch'
>;

type StatusPageListResponse = OkResponseBody<'/v1/status-pages', 'get'>;
type StatusPageResponse = OkResponseBody<'/v1/status-pages/{id}', 'get'>;
type StatusPageCheckSlugResponse = OkResponseBody<
  '/v1/status-pages/check-slug/{slug}',
  'get'
>;
type StatusPageCheckDomainResponse = OkResponseBody<
  '/v1/status-pages/check-domain/{domain}',
  'get'
>;
type StatusPageCreateResponse = OkResponseBody<'/v1/status-pages', 'post'>;
type StatusPageUpdateResponse = OkResponseBody<
  '/v1/status-pages/{id}',
  'patch'
>;
type StatusPagePublishResponse = OkResponseBody<
  '/v1/status-pages/{id}/{action}',
  'patch'
>;
type StatusPageSetGroupsResponse = OkResponseBody<
  '/v1/status-pages/{id}/servers',
  'patch'
>;

const groupServerSchema = z.object({
  server_id: z
    .number()
    .int()
    .positive()
    .describe('Server id from the account-wide monitor list (`monitor_list`).'),
  name: z
    .string()
    .min(1)
    .max(150)
    .describe('Display name shown on the status page.'),
  description: z
    .string()
    .max(500)
    .nullable()
    .optional()
    .describe('Optional comment shown under the server name.'),
  order: z
    .number()
    .int()
    .min(0)
    .describe('Display order within the group.'),
});

const groupSchema = z.object({
  id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Existing group id (omit to create a new group).'),
  name: z.string().min(1).max(150),
  description: z.string().max(500).nullable().optional(),
  order: z
    .number()
    .int()
    .min(0)
    .describe('Display order of the group on the page.'),
  servers: z.array(groupServerSchema),
});

const optionalStatusPageFields = {
  slug: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9_-]+$/)
    .optional()
    .describe(
      'URL-safe slug (3–50 chars, lowercase Latin letters, digits, hyphens, underscores). If omitted on create, a random one is generated.',
    ),
  description: z.string().max(500).nullable().optional(),
  domain: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Custom domain (must be a subdomain pointing to Statuser via CNAME). Requires `custom_domain_enabled`.',
    ),
  password: z
    .string()
    .min(3)
    .max(100)
    .nullable()
    .optional()
    .describe('Password to gate the page. Requires `password_protected_status_page`.'),
  is_indexed: z
    .boolean()
    .optional()
    .describe('Allow search engines to index the page. Requires `indexing_control_enabled` if you want to disable it.'),
  is_white_labeled: z
    .boolean()
    .optional()
    .describe('Hide Statuser branding. Requires `white_label_enabled`.'),
  is_published: z.boolean().optional(),
  timeline_days: z
    .union([
      z.literal(7),
      z.literal(14),
      z.literal(30),
      z.literal(60),
      z.literal(90),
      z.literal(180),
    ])
    .optional()
    .describe('How many days the timeline on the page covers. Must be one of: 7, 14, 30, 60, 90, 180.'),
  timezone: z.string().min(1).max(100).optional(),
  uptime_decimal_places: z.number().int().min(0).max(4).optional(),
  theme_mode: z
    .enum(['user', 'light', 'dark'])
    .optional()
    .describe(
      '`user` — follow viewer preference; `light` / `dark` — force theme.',
    ),
  is_not_monitored_operational: z.boolean().optional(),
  minimum_incident_duration: z
    .number()
    .int()
    .min(0)
    .max(86400)
    .optional()
    .describe(
      'Minimum incident duration (in seconds, 0–86400) before it appears on the page. Requires `status_page_minimum_incident_duration_enabled` to set above 0.',
    ),
  logo_url: z.string().nullable().optional(),
  favicon_url: z.string().nullable().optional(),
  company_url: z.string().nullable().optional(),
  support_url: z.string().nullable().optional(),
};

const createStatusPageFields = {
  name: z.string().min(1).max(150),
  ...optionalStatusPageFields,
};

const updateStatusPageFields = {
  name: z.string().min(1).max(150).optional(),
  ...optionalStatusPageFields,
};

export function registerStatusPageTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerTool(server, ctx, {
    name: 'status_page_list',
    title: 'List status pages',
    description:
      'Lists all status pages on the account with their full configuration: domain/slug, groups and linked monitors, theme, white-label, password protection, etc.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call<StatusPageListResponse>({
        method: 'GET',
        path: '/v1/status-pages',
      }),
  });

  registerTool(server, ctx, {
    name: 'status_page_get',
    title: 'Get status page',
    description:
      'Returns the full configuration of one status page by id: settings, groups, linked monitors and custom domains.',
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) =>
      client.call<StatusPageResponse>({
        method: 'GET',
        path: `/v1/status-pages/${id}`,
      }),
  });

  registerTool(server, ctx, {
    name: 'status_page_check_slug',
    title: 'Check if a slug is available',
    description:
      'Returns `{ available: boolean }` for the given slug. Useful before creating or renaming a status page.',
    inputSchema: {
      slug: z.string().min(1),
    },
    handler: async ({ slug }, { client }) =>
      client.call<StatusPageCheckSlugResponse>({
        method: 'GET',
        path: `/v1/status-pages/check-slug/${encodeURIComponent(slug)}`,
      }),
  });

  registerTool(server, ctx, {
    name: 'status_page_check_domain',
    title: 'Check custom-domain availability and CNAME',
    description:
      'Returns `{ available, cname_valid }` for the given domain: whether the domain is free and whether its CNAME points to Statuser. Useful before attaching a custom domain.',
    inputSchema: {
      domain: z.string().min(1),
    },
    handler: async ({ domain }, { client }) =>
      client.call<StatusPageCheckDomainResponse>({
        method: 'GET',
        path: `/v1/status-pages/check-domain/${encodeURIComponent(domain)}`,
      }),
  });

  registerTool(server, ctx, {
    name: 'status_page_create',
    title: 'Create status page',
    description:
      'Creates a public status page. `name` is required. If `slug` is omitted, a random one is generated. Plan-feature constraints apply for custom domain, password, indexing control, white-label, extended timeline and minimum incident duration. Account-level limit is `status_pages_limit` — 403 on overflow.',
    write: true,
    inputSchema: createStatusPageFields,
    handler: async (args, { client }) => {
      const body: StatusPageCreateBody = args;
      return client.call<StatusPageCreateResponse>({
        method: 'POST',
        path: '/v1/status-pages',
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_update',
    title: 'Update status page',
    description:
      'Partial update of status-page settings. Pass only the fields you want to change. Slug/domain conflicts → 409; plan-feature constraints → 403.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
      ...updateStatusPageFields,
    },
    handler: async ({ id, ...patch }, { client }) => {
      const body: StatusPageUpdateBody = patch;
      return client.call<StatusPageUpdateResponse>({
        method: 'PATCH',
        path: `/v1/status-pages/${id}`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_publish',
    title: 'Publish or unpublish status page',
    description:
      'Switches the page visibility for end users without deleting its configuration. `action = "published"` makes it reachable via slug/domain, `"unpublished"` hides it.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
      action: z.enum(['published', 'unpublished']),
    },
    handler: async ({ id, action }, { client }) =>
      client.call<StatusPagePublishResponse>({
        method: 'PATCH',
        path: `/v1/status-pages/${id}/${action}`,
      }),
  });

  registerTool(server, ctx, {
    name: 'status_page_set_groups',
    title: 'Replace status page groups & monitors',
    description:
      'Fully replaces the structure of groups and monitors on the page (idempotent replace, not merge). For each group: `name`, `order`, optional `description`, and `servers` — each item has `server_id` (from `monitor_list`), display `name`, `order`, optional `description`. Pass the existing group `id` to update a group, omit it to create a new one. Anything missing from the payload is removed.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
      groups: z.array(groupSchema),
    },
    handler: async ({ id, groups }, { client }) => {
      const body: StatusPageSetGroupsBody = { groups };
      return client.call<StatusPageSetGroupsResponse>({
        method: 'PATCH',
        path: `/v1/status-pages/${id}/servers`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_delete',
    title: 'Delete status page',
    description:
      'Permanently deletes a status page with its settings, groups and custom-domain binding. Irreversible. To hide a page without deleting, use `status_page_publish` with `action = "unpublished"`.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) => {
      await client.call({ method: 'DELETE', path: `/v1/status-pages/${id}` });
      return { deleted: true, id };
    },
  });
}
