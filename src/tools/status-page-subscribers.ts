import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from '../tool.js';
import type { OkResponseBody } from '../generated/helpers.js';

type SubscriberListResponse = OkResponseBody<
  '/v1/status-pages/{id}/subscribers',
  'get'
>;

export function registerStatusPageSubscriberTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerTool(server, ctx, {
    name: 'status_page_subscriber_list',
    title: 'List subscribers of a status page',
    description:
      'Lists visitors subscribed to status page updates by email (they receive emails about incident reports and planned maintenances). Returns each subscriber with `status` (`confirmed`, `pending`, `expired`, `unsubscribed`) and dates, plus `stats`: confirmed/pending counts, `total` (confirmed + pending) and the plan `limit` of active subscribers per page. Requires a plan with `status_page_subscribers_limit > 0` — otherwise the list is empty.',
    inputSchema: {
      status_page_id: z.number().int().positive(),
    },
    handler: async ({ status_page_id }, { client }) =>
      client.call<SubscriberListResponse>({
        method: 'GET',
        path: `/v1/status-pages/${status_page_id}/subscribers`,
      }),
  });

  registerTool(server, ctx, {
    name: 'status_page_subscriber_export',
    title: 'Export subscribers to CSV',
    description:
      'Exports all subscribers of a status page as CSV text with columns `email,status,confirmed_at,created_at`. Useful for backups or migrating the audience elsewhere.',
    inputSchema: {
      status_page_id: z.number().int().positive(),
    },
    handler: async ({ status_page_id }, { client }) => {
      const csv = await client.call<string>({
        method: 'GET',
        path: `/v1/status-pages/${status_page_id}/subscribers/export`,
      });
      return { csv };
    },
  });

  registerTool(server, ctx, {
    name: 'status_page_subscriber_delete',
    title: 'Delete a subscriber from status page',
    description:
      'Removes a subscriber from the status page. Irreversible: the person stops receiving emails and can only re-subscribe themselves on the public page. Subscriber ids come from `status_page_subscriber_list`.',
    write: true,
    inputSchema: {
      status_page_id: z.number().int().positive(),
      subscriber_id: z.number().int().positive(),
    },
    handler: async ({ status_page_id, subscriber_id }, { client }) => {
      await client.call({
        method: 'DELETE',
        path: `/v1/status-pages/${status_page_id}/subscribers/${subscriber_id}`,
      });
      return { deleted: true, subscriber_id };
    },
  });
}
