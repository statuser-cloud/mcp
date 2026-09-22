import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from '../tool.js';
import type { OkResponseBody, RequestBody } from '../generated/helpers.js';

type ProjectCreateBody = RequestBody<'/v1/projects', 'post'>;
type ProjectUpdateBody = RequestBody<'/v1/projects/{id}', 'patch'>;
type ProjectReorderBody = RequestBody<'/v1/projects/order', 'patch'>;
type ProjectChannelSetBody = RequestBody<
  '/v1/projects/{projectId}/channels',
  'patch'
>;

type ProjectListResponse = OkResponseBody<'/v1/projects', 'get'>;
type ProjectCreateResponse = OkResponseBody<'/v1/projects', 'post'>;
type ProjectUpdateResponse = OkResponseBody<'/v1/projects/{id}', 'patch'>;
type ProjectReorderResponse = OkResponseBody<'/v1/projects/order', 'patch'>;
type ProjectChannelListResponse = OkResponseBody<
  '/v1/projects/{projectId}/channels',
  'get'
>;
type ProjectChannelSetResponse = OkResponseBody<
  '/v1/projects/{projectId}/channels',
  'patch'
>;

const channelTypeEnum = z.enum(['email', 'telegram', 'max']);

export function registerProjectTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerTool(server, ctx, {
    name: 'project_list',
    title: 'List projects',
    description:
      'Lists the projects of the account, oldest first by id. A project owns monitors, status pages and monitoring notification rules; notification channels, billing and API keys belong to the account as a whole. Every account has at least one project. Calls that take no `project_id` read the whole account and write into the oldest project — use this tool to learn which one that is.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call<ProjectListResponse>({
        method: 'GET',
        path: '/v1/projects',
      }),
  });

  registerTool(server, ctx, {
    name: 'project_create',
    title: 'Create project',
    description:
      'Creates a project. Returns 403 when the plan limit is reached (1 on Free, 3 on Pro, 20 on Team) — monitors and status pages are counted per account, so a new project does not raise those limits. A new project starts with every notification channel switched OFF: monitoring notifications go nowhere until `project_channel_set` enables them. That is deliberate — a project is usually created for a new client, and channels enabled by default would send their alerts into somebody else’s chat.',
    write: true,
    inputSchema: {
      name: z
        .string()
        .min(1)
        .max(255)
        .describe(
          'Shown in the panel, in weekly report emails and on the public weekly report page (only when the account has more than one project).',
        ),
    },
    handler: async ({ name }, { client }) => {
      const body: ProjectCreateBody = { name };
      return client.call<ProjectCreateResponse>({
        method: 'POST',
        path: '/v1/projects',
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'project_update',
    title: 'Rename project',
    description:
      'Renames a project. Only the name can be changed here — moving content between projects is done through `monitor_update` and `status_page_update`.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
      name: z.string().min(1).max(255),
    },
    handler: async ({ id, name }, { client }) => {
      const body: ProjectUpdateBody = { name };
      return client.call<ProjectUpdateResponse>({
        method: 'PATCH',
        path: `/v1/projects/${id}`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'project_delete',
    title: 'Delete project',
    description:
      'Deletes a project. The last project of an account cannot be deleted (409) — it is where records created without a project go. A project that still holds monitors or status pages needs `move_to_project_id`, otherwise the call returns 409: content moves, settings do not. The notification rules, channel switches and webhook subscriptions of the deleted project are gone for good, and the moved monitors start living by the rules of the destination project — their alerts may end up in a different channel.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
      move_to_project_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Where to move the monitors and status pages of the deleted project. Required when it is not empty.',
        ),
    },
    handler: async ({ id, move_to_project_id }, { client }) =>
      client.call<void>({
        method: 'DELETE',
        path: `/v1/projects/${id}`,
        query: { move_to_project_id },
      }),
  });

  registerTool(server, ctx, {
    name: 'project_reorder',
    title: 'Reorder projects',
    description:
      'Sets the order projects are listed in inside the panel. Pass every project id of the account in the wanted order — a partial list is rejected (400). Cosmetic: the order changes nothing about delivery or about which project receives records created without one (that is always the oldest project).',
    write: true,
    inputSchema: {
      project_ids: z
        .array(z.number().int().positive())
        .min(1)
        .describe('All project ids of the account, in the wanted order.'),
    },
    handler: async ({ project_ids }, { client }) => {
      const body: ProjectReorderBody = { project_ids };
      return client.call<ProjectReorderResponse>({
        method: 'PATCH',
        path: '/v1/projects/order',
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'project_channel_list',
    title: 'List channels of a project',
    description:
      'Lists the notification channels of the account (confirmed emails, linked Telegram and MAX chats) together with whether this project uses them. A channel is connected once for the whole account; a project only switches it on or off for its own monitoring notifications. Account-level notifications — invoices, security, API keys — reach every channel regardless of this setting. Webhooks are not here: their scope is stored on the subscription, see `webhook_update`.',
    inputSchema: {
      project_id: z.number().int().positive(),
    },
    handler: async ({ project_id }, { client }) =>
      client.call<ProjectChannelListResponse>({
        method: 'GET',
        path: `/v1/projects/${project_id}/channels`,
      }),
  });

  registerTool(server, ctx, {
    name: 'project_channel_set',
    title: 'Switch a channel on or off in a project',
    description:
      'Turns one notification channel on or off for this project and returns the full updated list. Affects monitoring notifications only. Switching a channel off here does not disconnect it from the account — other projects keep using it.',
    write: true,
    inputSchema: {
      project_id: z.number().int().positive(),
      type: channelTypeEnum.describe('Kind of channel to switch.'),
      channel_id: z
        .number()
        .int()
        .positive()
        .describe(
          'Id of the channel inside its own list — as returned by `project_channel_list`, `notification_email_list`, `telegram_linked_list` or `max_linked_list`.',
        ),
      is_enabled: z.boolean(),
    },
    handler: async (
      { project_id, type, channel_id, is_enabled },
      { client },
    ) => {
      const body: ProjectChannelSetBody = { type, channel_id, is_enabled };
      return client.call<ProjectChannelSetResponse>({
        method: 'PATCH',
        path: `/v1/projects/${project_id}/channels`,
        body,
      });
    },
  });
}
