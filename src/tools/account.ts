import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from '../tool.js';
import type { OkResponseBody, RequestBody } from '../generated/helpers.js';

type AccountUpdateBody = RequestBody<'/v1/account', 'patch'>;
type HolidayModeSetBody = RequestBody<'/v1/holiday-mode', 'post'>;
type TelegramSetTopicBody = RequestBody<'/v1/telegram/set-topic', 'patch'>;
type MaxUnlinkBody = RequestBody<'/v1/max/unlink', 'delete'>;
type MaxSet2faBody = RequestBody<'/v1/max/2fa-account', 'patch'>;

type AccountResponse = OkResponseBody<'/v1/account', 'get'>;
type AccountUpdateResponse = OkResponseBody<'/v1/account', 'patch'>;
type CurrentPlanResponse = OkResponseBody<'/v1/billing/current-plan', 'get'>;
type PlanListResponse = OkResponseBody<'/v1/billing/plans', 'get'>;
type HolidayModeGetResponse = OkResponseBody<'/v1/holiday-mode', 'get'>;
type HolidayModeSetResponse = OkResponseBody<'/v1/holiday-mode', 'post'>;
type TwoFactorInfoResponse = OkResponseBody<'/v1/2fa', 'get'>;
type TelegramLinkedListResponse = OkResponseBody<'/v1/telegram/linked', 'get'>;
type MaxLinkedListResponse = OkResponseBody<'/v1/max/linked', 'get'>;
type MaxLinksResponse = OkResponseBody<'/v1/max/links', 'get'>;
type ActivityLogListResponse = OkResponseBody<'/v1/activity-log', 'get'>;

const ACTIVITY_LOG_CATEGORIES = [
  'monitoring',
  'status_pages',
  'security',
  'billing',
] as const;
const ACTIVITY_LOG_ACTOR_TYPES = ['user', 'api_key', 'system'] as const;
const ACTIVITY_LOG_TARGET_TYPES = [
  'server',
  'notification_rule',
  'notification_email',
  'webhook',
  'integration',
  'account',
  'session',
  'api_key',
  'passkey',
  'status_page',
  'status_page_report',
  'status_page_maintenance',
  'status_page_announcement',
  'incident',
  'plan',
  'payment_card',
  'payer',
] as const;

// Shared filter schema for the activity log list and export tools.
const activityLogFilterSchema = {
  category: z
    .array(z.enum(ACTIVITY_LOG_CATEGORIES))
    .optional()
    .describe(
      'Sections: `monitoring` (servers, notification channels, webhooks, holiday mode), `status_pages` (status pages, reports, maintenances, announcements, incidents), `security` (login, password, sessions, API keys, 2FA, account profile), `billing` (plan, payer, cards).',
    ),
  actor_type: z
    .array(z.enum(ACTIVITY_LOG_ACTOR_TYPES))
    .optional()
    .describe(
      'Who performed the action: `user` (account owner via panel, bots or Statuser AI), `api_key` (public API or MCP), `system` (schedulers and plan enforcement).',
    ),
  target_type: z
    .enum(ACTIVITY_LOG_TARGET_TYPES)
    .optional()
    .describe('Type of the object the entry is about.'),
  target_id: z
    .string()
    .optional()
    .describe(
      'Object id as a string (sessions use UUIDs). Together with `target_type` gives the history of one object.',
    ),
  action: z
    .array(z.string())
    .optional()
    .describe(
      'Action codes in `<object>.<verb>` form, e.g. `server.pause`, `status_page.delete`, `auth.login`. Combined with `search` as OR.',
    ),
  from: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      'Lower time bound (inclusive), ISO 8601. Cannot reach past the plan retention window.',
    ),
  to: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('Upper time bound (inclusive), ISO 8601.'),
  search: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Case-insensitive search by object label (server name or host, status page name) and actor label (API key name, email).',
    ),
};

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
      client.call<AccountResponse>({ method: 'GET', path: '/v1/account' }),
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
      return client.call<AccountUpdateResponse>({
        method: 'PATCH',
        path: '/v1/account',
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'current_plan_get',
    title: 'Get current plan and feature flags',
    description:
      'Returns the active plan with its price, full `features` object (limits and feature flags), and subscription metadata (`valid_until`, `current_billing_period`, `pending_plan`). Useful to check gates before calling feature-restricted endpoints.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call<CurrentPlanResponse>({
        method: 'GET',
        path: '/v1/billing/current-plan',
      }),
  });

  registerTool(server, ctx, {
    name: 'plan_list',
    title: 'List public plans',
    description:
      'Returns the public Statuser plan catalog with prices, limits and features. No authentication required.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call<PlanListResponse>({
        method: 'GET',
        path: '/v1/billing/plans',
      }),
  });

  registerTool(server, ctx, {
    name: 'activity_log_list',
    title: 'List account activity log',
    description:
      'Returns the account audit log newest first: who changed what and when — the owner (panel, bots, Statuser AI), API keys (public API, MCP) or the system (plan enforcement, autopay, expirations). Answers questions like "who paused this server", "when was the account logged into", "what did the system disable after a downgrade". Each entry has `action` (stable `<object>.<verb>` code), actor, source, target, masked `changes` (was → became), `details`, `ip` and geo `location`. Depth is limited by the plan window: `retention_days` in the response (`null` = unlimited). Support staff actions are never included.',
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Page size, 1..100 (default 20).'),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Offset from the newest entry (default 0).'),
      ...activityLogFilterSchema,
    },
    handler: async (args, { client }) =>
      client.call<ActivityLogListResponse>({
        method: 'GET',
        path: '/v1/activity-log',
        query: args,
      }),
  });

  registerTool(server, ctx, {
    name: 'activity_log_export',
    title: 'Export account activity log as CSV',
    description:
      'Downloads the activity log as CSV under the same filters as `activity_log_list` (pagination is ignored). Columns: `id, created_at (UTC), action, actor_type, actor_label, source, target_type, target_id, target_label, ip, country, city, user_agent, changes (JSON), details (JSON)`. At most 50 000 newest rows per call; `truncated: true` in the result means the history is longer — narrow `from`/`to` or filters and repeat. Available on plans with `activity_log_export_enabled` (Team); otherwise fails with `activity_log_export_unavailable`. The export itself is recorded in the log as `activity_log.export`. Prefer `activity_log_list` for questions — use this tool only when the user explicitly wants a file or a full dump.',
    inputSchema: { ...activityLogFilterSchema },
    handler: async (args, { client }) => {
      const res = await client.callBinary({
        method: 'GET',
        path: '/v1/activity-log/export',
        query: args,
      });
      const csv = res.bytes.toString('utf8');
      const rows = Math.max(0, csv.split('\n').filter(Boolean).length - 1);
      return {
        filename: res.filename ?? 'activity-log.csv',
        rows,
        truncated: res.headers['x-export-truncated'] === 'true',
        csv,
      };
    },
  });

  registerTool(server, ctx, {
    name: 'holiday_mode_get',
    title: 'Get holiday-mode status',
    description:
      'Returns the current state of "holiday/vacation" mode: if active, `holiday_until` contains the end timestamp; otherwise `null`. While active, Statuser does not send personal incident notifications (checks still run and incidents are still recorded).',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call<HolidayModeGetResponse>({
        method: 'GET',
        path: '/v1/holiday-mode',
      }),
  });

  registerTool(server, ctx, {
    name: 'holiday_mode_set',
    title: 'Enable or disable holiday mode',
    description:
      'Enables holiday mode until the given timestamp (`holiday_until` in ISO 8601) or disables it if `holiday_until` is omitted. While active, personal notifications are suppressed; monitors keep running and incidents are still recorded.',
    write: true,
    inputSchema: {
      holiday_until: z
        .string()
        .optional()
        .describe(
          'ISO 8601 timestamp (must be in the future) at which holiday mode ends. Omit to disable holiday mode.',
        ),
    },
    handler: async (args, { client }) => {
      const body: HolidayModeSetBody = {
        holiday_until: args.holiday_until ?? null,
      };
      return client.call<HolidayModeSetResponse>({
        method: 'POST',
        path: '/v1/holiday-mode',
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'two_factor_info',
    title: 'Get 2FA info',
    description:
      'Returns the current state of two-factor authentication: `preferred_method` (active second factor, may be `null`) and `allowed_methods` (which methods are selectable). Allowed values: `email` (always), `totp` (when TOTP is configured), `telegram` (when a Telegram chat is linked), `max` (when a MAX chat is linked).',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call<TwoFactorInfoResponse>({ method: 'GET', path: '/v1/2fa' }),
  });

  registerTool(server, ctx, {
    name: 'telegram_linked_list',
    title: 'List linked Telegram chats',
    description:
      'Returns all Telegram personal accounts and group chats linked to the Statuser account with their settings: chat id, type, username, avatar, 2FA flag, selected topic and available topics for supergroup-forum groups.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call<TelegramLinkedListResponse>({
        method: 'GET',
        path: '/v1/telegram/linked',
      }),
  });

  registerTool(server, ctx, {
    name: 'telegram_set_topic',
    title: 'Set Telegram topic for notifications',
    description:
      'Routes Statuser notifications to a specific topic (`message_thread_id`) in a Telegram chat — typically useful for supergroup forums. Pass `message_thread_id: null` to clear the binding and post to the main chat. Use `telegram_linked_list` to discover available topics.',
    write: true,
    inputSchema: {
      telegram_id: z
        .string()
        .describe('Telegram chat id (from `telegram_linked_list`).'),
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
      client.call<MaxLinkedListResponse>({
        method: 'GET',
        path: '/v1/max/linked',
      }),
  });

  registerTool(server, ctx, {
    name: 'max_get_link',
    title: 'Get MAX deeplinks for binding',
    description:
      'Returns a pair of deeplinks: `link_user` (open in personal MAX chat with the bot) and `link_group` (add the bot to a group and follow the link). After confirmation, the MAX chat/account becomes available as a notifications channel. Repeated calls before the link is consumed are idempotent — same links are returned.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call<MaxLinksResponse>({
        method: 'GET',
        path: '/v1/max/links',
      }),
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
