import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from '../tool.js';
import type { OkResponseBody, RequestBody } from '../generated/helpers.js';

type AnnouncementCreateBody = RequestBody<
  '/v1/status-pages/{id}/announcements',
  'post'
>;

type AnnouncementListResponse = OkResponseBody<
  '/v1/status-pages/{id}/announcements',
  'get'
>;
type AnnouncementCreateResponse = OkResponseBody<
  '/v1/status-pages/{id}/announcements',
  'post'
>;
type AnnouncementUpdateResponse = OkResponseBody<
  '/v1/status-pages/{id}/announcements/{announcementId}',
  'patch'
>;

const announcementTypeEnum = z
  .enum(['info', 'warning', 'critical'])
  .describe(
    'Severity of the announcement: `info` (blue), `warning` (yellow) or `critical` (red).',
  );

export function registerStatusPageAnnouncementTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerTool(server, ctx, {
    name: 'status_page_announcement_list',
    title: 'List announcements for a status page',
    description:
      'Lists announcements (banner notices shown on top of the public status page): title, body, type/severity, optional display window (`started_at`/`ended_at`) and optional link. Includes scheduled, active and ended entries — filter by time on the client side.',
    inputSchema: {
      status_page_id: z.number().int().positive(),
    },
    handler: async ({ status_page_id }, { client }) =>
      client.call<AnnouncementListResponse>({
        method: 'GET',
        path: `/v1/status-pages/${status_page_id}/announcements`,
      }),
  });

  registerTool(server, ctx, {
    name: 'status_page_announcement_create',
    title: 'Create an announcement',
    description:
      'Publishes a banner announcement on the status page: `title`, `body`, optional `type` (defaults to `info`), optional display window and link. If `started_at`/`ended_at` are omitted, the announcement is shown until it is deleted or ended. Announcements require a plan with `status_page_announcements_enabled` — otherwise 403 `status_page_announcement_not_allowed`.',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      title: z.string().min(3).max(255),
      body: z.string().min(1).describe('Announcement text.'),
      type: announcementTypeEnum.optional(),
      started_at: z
        .string()
        .optional()
        .describe('ISO 8601. Start of the display window (optional).'),
      ended_at: z
        .string()
        .optional()
        .describe('ISO 8601. End of the display window (optional).'),
      link: z
        .string()
        .url()
        .optional()
        .describe('Optional URL shown as a "Подробнее" button in the banner.'),
    },
    handler: async ({ status_page_id, ...rest }, { client }) => {
      const body: AnnouncementCreateBody = rest;
      return client.call<AnnouncementCreateResponse>({
        method: 'POST',
        path: `/v1/status-pages/${status_page_id}/announcements`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_announcement_update',
    title: 'Edit an announcement',
    description:
      'Edits an announcement: `title`, `body`, `type`, display window and link. Pass `null` for `started_at`, `ended_at` or `link` to clear them. To stop an active announcement immediately, set `ended_at` to the current time.',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      announcement_id: z.number().int().positive(),
      title: z.string().min(3).max(255).optional(),
      body: z.string().min(1).optional(),
      type: announcementTypeEnum.optional(),
      started_at: z.string().nullable().optional(),
      ended_at: z.string().nullable().optional(),
      link: z.string().url().nullable().optional(),
    },
    handler: async (
      { status_page_id, announcement_id, ...patch },
      { client },
    ) => {
      // started_at/ended_at/link в OpenAPI-спеке update-эндпоинта пришли без явного
      // типа (огрех swagger-аннотаций в UpdateStatusPageAnnouncementDto), поэтому тело
      // передаём без строгого generated-типа — рантайм принимает ISO-строки и null.
      return client.call<AnnouncementUpdateResponse>({
        method: 'PATCH',
        path: `/v1/status-pages/${status_page_id}/announcements/${announcement_id}`,
        body: patch,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_announcement_delete',
    title: 'Delete an announcement from status page',
    description:
      'Removes an announcement from the status page. Irreversible.',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      announcement_id: z.number().int().positive(),
    },
    handler: async ({ status_page_id, announcement_id }, { client }) => {
      await client.call({
        method: 'DELETE',
        path: `/v1/status-pages/${status_page_id}/announcements/${announcement_id}`,
      });
      return { deleted: true, announcement_id };
    },
  });
}
