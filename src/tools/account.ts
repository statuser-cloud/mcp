import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from '../tool.js';
import type { RequestBody } from '../generated/helpers.js';

type AccountUpdateBody = RequestBody<'/v1/account', 'patch'>;
type HolidayModeSetBody = RequestBody<'/v1/holiday-mode', 'post'>;
type TelegramSetTopicBody = RequestBody<'/v1/telegram/set-topic', 'patch'>;
type MaxUnlinkBody = RequestBody<'/v1/max/unlink', 'delete'>;
type MaxSet2faBody = RequestBody<'/v1/max/2fa-account', 'patch'>;

export function registerAccountTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerTool(server, ctx, {
    name: 'account_get',
    title: 'Get account profile',
    description:
      'Returns the profile of the current account: `id`, email, name, status, avatar, creation date, password-change date, timezone and the AI-assistant flag. Plan/limit info is not here — use `current_plan_get`.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call({ method: 'GET', path: '/v1/account' }),
  });

  registerTool(server, ctx, {
    name: 'account_update',
    title: 'Update account profile',
    description:
      'Partial update of the account profile. Mutable fields: `name`, `timezone`, `is_ai_assistant_enabled`. Pass only the fields you want to change.',
    write: true,
    inputSchema: {
      name: z.string().optional(),
      timezone: z.string().optional(),
      is_ai_assistant_enabled: z.boolean().optional(),
    },
    handler: async (args, { client }) => {
      const body: AccountUpdateBody = args;
      return client.call({ method: 'PATCH', path: '/v1/account', body });
    },
  });

  registerTool(server, ctx, {
    name: 'current_plan_get',
    title: 'Get current plan and feature flags',
    description:
      'Returns the active plan with its price, full `features` object (limits and feature flags), and subscription metadata (`valid_until`, `current_billing_period`, `pending_plan`). Useful to check gates before calling feature-restricted endpoints.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call({ method: 'GET', path: '/v1/billing/current-plan' }),
  });

  registerTool(server, ctx, {
    name: 'plan_list',
    title: 'List public plans',
    description:
      'Returns the public Statuser plan catalog with prices, limits and features. No authentication required.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call({ method: 'GET', path: '/v1/billing/plans' }),
  });

  registerTool(server, ctx, {
    name: 'holiday_mode_get',
    title: 'Get holiday-mode status',
    description:
      'Returns the current state of "holiday/vacation" mode: if active, `holiday_until` contains the end timestamp; otherwise `null`. While active, Statuser does not send personal incident notifications (checks still run and incidents are still recorded).',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call({ method: 'GET', path: '/v1/holiday-mode' }),
  });

  registerTool(server, ctx, {
    name: 'holiday_mode_set',
    title: 'Enable or disable holiday mode',
    description:
      'Enables holiday mode until the given timestamp (`holiday_until` in ISO 8601) or disables it if `null` is passed. While active, personal notifications are suppressed; monitors keep running and incidents are still recorded.',
    write: true,
    inputSchema: {
      holiday_until: z
        .string()
        .nullable()
        .describe(
          'ISO 8601 timestamp at which holiday mode ends, or `null` to disable.',
        ),
    },
    handler: async (args, { client }) => {
      const body: HolidayModeSetBody = args;
      return client.call({ method: 'POST', path: '/v1/holiday-mode', body });
    },
  });

  registerTool(server, ctx, {
    name: 'two_factor_info',
    title: 'Get 2FA info',
    description:
      'Returns the current state of two-factor authentication: `preferred_method` (active second factor, may be `null`) and `allowed_methods` (which methods are selectable). Allowed values: `email` (always), `totp` (when TOTP is configured), `telegram` (when a Telegram chat is linked), `max` (when a MAX chat is linked).',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call({ method: 'GET', path: '/v1/2fa' }),
  });

  registerTool(server, ctx, {
    name: 'telegram_linked_list',
    title: 'List linked Telegram chats',
    description:
      'Returns all Telegram personal accounts and group chats linked to the Statuser account with their settings: chat id, type, username, avatar, 2FA flag, selected topic and available topics for supergroup-forum groups.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call({ method: 'GET', path: '/v1/telegram/linked' }),
  });

  registerTool(server, ctx, {
    name: 'telegram_set_topic',
    title: 'Set Telegram topic for notifications',
    description:
      'Routes Statuser notifications to a specific topic (`message_thread_id`) in a Telegram chat — typically useful for supergroup forums. Pass `message_thread_id: null` to clear the binding and post to the main chat. Use `telegram_linked_list` to discover available topics.',
    write: true,
    inputSchema: {
      telegram_id: z.string().describe('Telegram chat id (from `telegram_linked_list`).'),
      message_thread_id: z.number().int().nullable(),
    },
    handler: async (args, { client }) => {
      const body: TelegramSetTopicBody = args;
      return client.call({
        method: 'PATCH',
        path: '/v1/telegram/set-topic',
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'max_linked_list',
    title: 'List linked MAX accounts',
    description:
      'Returns all MAX accounts and group chats linked to the Statuser account, with status and the "used for 2FA" flag. Available as a notification channel in notification rules.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call({ method: 'GET', path: '/v1/max/linked' }),
  });

  registerTool(server, ctx, {
    name: 'max_get_link',
    title: 'Get MAX deeplinks for binding',
    description:
      'Returns a pair of deeplinks: `link_user` (open in personal MAX chat with the bot) and `link_group` (add the bot to a group and follow the link). After confirmation, the MAX chat/account becomes available as a notifications channel. Repeated calls before the link is consumed are idempotent — same links are returned.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call({ method: 'GET', path: '/v1/max/links' }),
  });

  registerTool(server, ctx, {
    name: 'max_unlink',
    title: 'Unlink MAX account',
    description:
      'Unlinks a MAX account from the Statuser account. Notifications will stop going to it; notification rules stop including it. If the account was the 2FA channel, its 2FA role is cleared automatically — but it is recommended to first switch the second factor via another channel if no other 2FA channel is configured.',
    write: true,
    inputSchema: {
      max_id: z.string(),
    },
    handler: async ({ max_id }, { client }) => {
      const body: MaxUnlinkBody = { max_id };
      await client.call({
        method: 'DELETE',
        path: '/v1/max/unlink',
        body,
      });
      return { unlinked: true, max_id };
    },
  });

  registerTool(server, ctx, {
    name: 'max_set_2fa_account',
    title: 'Change the MAX account used for 2FA',
    description:
      'Switches which linked MAX account receives second-factor confirmation codes. Must be one of the accounts already linked to the Statuser account.',
    write: true,
    inputSchema: {
      max_id: z.string(),
    },
    handler: async ({ max_id }, { client }) => {
      const body: MaxSet2faBody = { max_id };
      return client.call({
        method: 'PATCH',
        path: '/v1/max/2fa-account',
        body,
      });
    },
  });
}
