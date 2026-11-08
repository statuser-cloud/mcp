import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from '../tool.js';
import type {
  Expect,
  OkResponseBody,
  RequestBody,
  ResponseBody,
  SameValues,
  SpecEnum,
} from '../generated/helpers.js';

type WebhookCreateBody = RequestBody<'/v1/webhooks', 'post'>;
type WebhookUpdateBody = RequestBody<'/v1/webhooks/{id}', 'patch'>;
type NotificationRuleSetBody = RequestBody<'/v1/notification-rules', 'patch'>;
type NotificationEmailAddBody = RequestBody<'/v1/notification-emails', 'post'>;
type NotificationEmailConfirmBody = RequestBody<
  '/v1/notification-emails/{id}/confirm',
  'post'
>;

type WebhookListResponse = OkResponseBody<'/v1/webhooks', 'get'>;
type WebhookCreateResponse = OkResponseBody<'/v1/webhooks', 'post'>;
type WebhookUpdateResponse = OkResponseBody<'/v1/webhooks/{id}', 'patch'>;
type NotificationRuleListResponse = OkResponseBody<
  '/v1/notification-rules',
  'get'
>;
type NotificationRuleSetResponse = OkResponseBody<
  '/v1/notification-rules',
  'patch'
>;
type NotificationEmailListResponse = OkResponseBody<
  '/v1/notification-emails',
  'get'
>;
type NotificationEmailAddResponse = OkResponseBody<
  '/v1/notification-emails',
  'post'
>;
type NotificationEmailConfirmResponse = OkResponseBody<
  '/v1/notification-emails/{id}/confirm',
  'post'
>;
type NotificationPhoneListResponse = OkResponseBody<
  '/v1/notification-phones',
  'get'
>;
type NotificationPhoneTestResponse = ResponseBody<
  '/v1/notification-phones/{id}/test-notify',
  'post',
  202
>;
type NotificationPhoneTestResultResponse = OkResponseBody<
  '/v1/notification-phones/{id}/test-calls/{callId}',
  'get'
>;

// All public subscription types — used for per-channel notification rules.
const notificationRuleSubscriptionEnum = z.enum([
  'updates',
  'weekly_reports',
  'service_alerts',
  'ssl_alerts',
  'domain_alerts',
  'dns_alerts',
  'blocklist_alerts',
  'ideas',
  'billing_alerts',
  'holiday_mode',
  'api_key_alerts',
  'security_alerts',
]);

// Webhook-eligible subset (excludes `updates`, which is product newsletter
// delivered through other channels only).
const webhookSubscriptionEnum = z.enum([
  'weekly_reports',
  'service_alerts',
  'ssl_alerts',
  'domain_alerts',
  'dns_alerts',
  'blocklist_alerts',
  'ideas',
  'billing_alerts',
  'holiday_mode',
  'api_key_alerts',
  'security_alerts',
]);

// Both enums are copied from the API; pin them so an added type fails the
// build instead of being rejected by the tool. `test_alerts` and `receipt` are
// internal: the API never returns them in rules, so the tool leaves them out.
type _RuleTypesMatchApi = Expect<
  SameValues<
    z.infer<typeof notificationRuleSubscriptionEnum>,
    Exclude<
      SpecEnum<NotificationRuleSetBody['type']>,
      'test_alerts' | 'receipt'
    >
  >
>;
type _WebhookTypesMatchApi = Expect<
  SameValues<
    z.infer<typeof webhookSubscriptionEnum>,
    SpecEnum<WebhookCreateBody['subscriptions']>
  >
>;

export function registerNotificationTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  // ---------- Webhooks ----------

  registerTool(server, ctx, {
    name: 'webhook_list',
    title: 'List webhooks',
    description:
      'Lists all webhook endpoints configured on the account: name, URL, and the set of `subscriptions` (event types delivered to that webhook). The secret set on creation is not returned. `is_disabled_by_plan: true` means the current plan has no webhooks: no events are delivered, but the URL, secret and subscriptions are kept and work again after an upgrade.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call<WebhookListResponse>({
        method: 'GET',
        path: '/v1/webhooks',
      }),
  });

  registerTool(server, ctx, {
    name: 'webhook_create',
    title: 'Create webhook',
    description:
      'Registers a new webhook endpoint. Statuser will POST events of the chosen `subscriptions` types. Optionally set a `secret`: Statuser will sign payloads with it so the receiver can verify origin. Requires `webhook_notifications_enabled` on the plan.',
    write: true,
    inputSchema: {
      name: z.string().min(1).max(255),
      url: z.string().url(),
      secret: z
        .string()
        .nullable()
        .optional()
        .describe(
          'Signing secret. Omit (or pass `null`) if you do not want signatures.',
        ),
      subscriptions: z.array(webhookSubscriptionEnum),
      project_ids: z
        .array(z.number().int().positive())
        .optional()
        .describe(
          'Projects whose monitoring events go to this webhook. Omitted, the oldest project of the account is used. An empty array is meaningful: it switches monitoring events off entirely, while account events (invoices, security, API keys) keep arriving regardless of projects.',
        ),
    },
    handler: async (args, { client }) => {
      // Backend DTO marks `secret` as required (string | null), but for the
      // tool we want callers to be able to omit it. Normalize undefined -> null
      // so the wire payload still matches the swagger spec.
      const body: WebhookCreateBody = { ...args, secret: args.secret ?? null };
      return client.call<WebhookCreateResponse>({
        method: 'POST',
        path: '/v1/webhooks',
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'webhook_update',
    title: 'Update webhook',
    description:
      'Partial update of an existing webhook. Pass only the fields you want to change. Pass `secret: null` to clear the signing secret. Once changed, signatures are computed with the new value — update the receiver accordingly.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
      name: z.string().min(1).max(255).optional(),
      url: z.string().url().optional(),
      secret: z.string().nullable().optional(),
      subscriptions: z.array(webhookSubscriptionEnum).optional(),
      project_ids: z
        .array(z.number().int().positive())
        .optional()
        .describe(
          'Full set of projects whose monitoring events go to this webhook — the list replaces the previous one. Omitted, the set stays as it was. An empty array switches monitoring events off entirely; account events keep arriving.',
        ),
    },
    handler: async ({ id, ...patch }, { client }) => {
      const body: WebhookUpdateBody = patch;
      return client.call<WebhookUpdateResponse>({
        method: 'PATCH',
        path: `/v1/webhooks/${id}`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'webhook_delete',
    title: 'Delete webhook',
    description:
      'Removes a webhook endpoint. Statuser will stop sending events to it. To stop only some event types without deleting, use `webhook_update` and shrink the `subscriptions` list.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) => {
      await client.call({ method: 'DELETE', path: `/v1/webhooks/${id}` });
      return { deleted: true, id };
    },
  });

  registerTool(server, ctx, {
    name: 'webhook_test',
    title: 'Send test request to webhook',
    description:
      'Sends a test payload (flagged as a test) to the webhook to verify availability, signature handling and receiver behavior. On delivery failure returns 502 with details (`reason`, `webhook_status`) — handy for debugging integrations.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) => {
      await client.call({
        method: 'POST',
        path: `/v1/webhooks/${id}/test-notify`,
      });
      return { sent: true, id };
    },
  });

  // ---------- Notification rules ----------

  registerTool(server, ctx, {
    name: 'notification_rule_list',
    title: 'List notification rules',
    description:
      'Returns the current matrix of notification rules: for each subscription type (`service_alerts`, `ssl_alerts`, `domain_alerts`, `dns_alerts`, `blocklist_alerts`, `weekly_reports`, `updates`, `billing_alerts`, `holiday_mode`, `api_key_alerts`, `security_alerts`, `ideas`) — boolean flags `email` / `telegram` / `max` and one per work chat (`mattermost`, `rocketchat`, `pachca`, `discord`, `slack`) indicating whether that kind of channel gets the event. Account-level types are off for work chats by default: a work chat is usually shared with a team or a client. Every rule carries a `scope`: monitoring types (`service_alerts`, `ssl_alerts`, `domain_alerts`, `dns_alerts`, `blocklist_alerts`, `weekly_reports`) belong to a PROJECT and differ from project to project, the rest belong to the account. Without `project_id` the monitoring half is read from the oldest project. Webhooks have their own per-webhook `subscriptions` field and do not appear here.',
    inputSchema: {
      project_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Whose monitoring rules to read. Omitted, the oldest project of the account is used — pass it explicitly when the account has more than one project, see `project_list`.',
        ),
    },
    handler: async ({ project_id }, { client }) =>
      client.call<NotificationRuleListResponse>({
        method: 'GET',
        path: '/v1/notification-rules',
        query: { project_id },
      }),
  });

  registerTool(server, ctx, {
    name: 'notification_rule_set',
    title: 'Set notification rule for a subscription type',
    description:
      'Creates or updates the rule for a single subscription type: toggles channels `email`, `telegram`, `max` and, optionally, the work chats `mattermost`, `rocketchat`, `pachca`, `discord`, `slack` — a work-chat flag that is not passed stays as it is. Selecting individual recipients or chats is not possible — the toggle is on/off per kind of channel; which exact addresses and chats a project uses is decided by `project_channel_set`. Monitoring types apply to ONE project (the oldest one unless `project_id` says otherwise), account types (`billing_alerts`, `security_alerts`, `api_key_alerts`, `updates`, `ideas`, `holiday_mode`) apply to the account as a whole. Returns the full updated list of rules.',
    write: true,
    inputSchema: {
      type: notificationRuleSubscriptionEnum,
      email: z.boolean(),
      telegram: z.boolean(),
      max: z.boolean(),
      // Optional on purpose: the API leaves an omitted work-chat flag as it is,
      // and clients written before work chats keep sending three flags
      mattermost: z.boolean().optional(),
      rocketchat: z.boolean().optional(),
      pachca: z.boolean().optional(),
      discord: z.boolean().optional(),
      slack: z.boolean().optional(),
      project_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Which project the rule belongs to, for monitoring types. Omitted, the oldest project is changed — on an account with several projects that is rarely what the user means. Ignored for account-level types.',
        ),
    },
    handler: async (args, { client }) => {
      const body: NotificationRuleSetBody = args;
      return client.call<NotificationRuleSetResponse>({
        method: 'PATCH',
        path: '/v1/notification-rules',
        body,
      });
    },
  });

  // ---------- Notification emails ----------

  registerTool(server, ctx, {
    name: 'notification_email_list',
    title: 'List notification emails',
    description:
      'Lists every email address added to the account for notifications, with confirmation status. Notifications go only to confirmed addresses; unconfirmed ones are shown for UX but are not used by notification rules.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call<NotificationEmailListResponse>({
        method: 'GET',
        path: '/v1/notification-emails',
      }),
  });

  registerTool(server, ctx, {
    name: 'notification_email_add',
    title: 'Add notification email (sends a confirmation code)',
    description:
      'Adds a new email address and immediately sends a confirmation code to it. The address becomes effective for notification rules only after confirmation via `notification_email_confirm`. Returns 409 if the address is already confirmed; 429 if a code was just sent; 403 if the per-account limit is reached.',
    write: true,
    inputSchema: {
      email: z.string().email(),
    },
    handler: async ({ email }, { client }) => {
      const body: NotificationEmailAddBody = { email };
      return client.call<NotificationEmailAddResponse>({
        method: 'POST',
        path: '/v1/notification-emails',
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'notification_email_confirm',
    title: 'Confirm notification email with code',
    description:
      'Verifies the code received by email and marks the address as confirmed. Wrong, expired or attempts-exhausted code returns 403; in that case the code is invalidated and a new one must be requested via `notification_email_resend`.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
      code: z.string().min(1),
    },
    handler: async ({ id, code }, { client }) => {
      const body: NotificationEmailConfirmBody = { code };
      return client.call<NotificationEmailConfirmResponse>({
        method: 'POST',
        path: `/v1/notification-emails/${id}/confirm`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'notification_email_resend',
    title: 'Resend confirmation code',
    description:
      'Resends the confirmation letter to an unconfirmed email. If the address is already confirmed — 409; if you call too often — 429 (wait for cooldown).',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) => {
      await client.call({
        method: 'POST',
        path: `/v1/notification-emails/${id}/resend`,
      });
      return { sent: true, id };
    },
  });

  registerTool(server, ctx, {
    name: 'notification_email_remove',
    title: 'Remove notification email',
    description:
      'Removes an email address from the notification recipients list. Rules that included this address stop delivering to it. Irreversible — to use the same address again, it must be added and confirmed once more.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) => {
      await client.call({
        method: 'DELETE',
        path: `/v1/notification-emails/${id}`,
      });
      return { deleted: true, id };
    },
  });

  // ---------- Notification phones ----------

  registerTool(server, ctx, {
    name: 'notification_phone_list',
    title: 'List phones for outage calls',
    description:
      'Lists the phones of the account that Statuser calls when a monitor goes down. A call goes only to a confirmed phone (`status: confirmed`) that is switched on in the project of the monitor (`project_channel_list`) while calls are on in that project (`project_voice_calls_get`). A phone still being confirmed carries `confirmation` — which number to call from it and until when. Phones are added and confirmed in the Statuser panel only.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call<NotificationPhoneListResponse>({
        method: 'GET',
        path: '/v1/notification-phones',
      }),
  });

  registerTool(server, ctx, {
    name: 'notification_phone_test',
    title: 'Place a test call to a phone',
    description:
      'Places a real test call to a confirmed phone — the same call as on an outage — and spends one call from the balance (`call_balance_get`). Notification rules and project settings do not apply: only the phone itself is checked. Returns `call_id`; the outcome usually arrives within a minute, read it with `notification_phone_test_result`. 409 — the phone is not confirmed, no calls are left, or the previous test call is still going; 429 — too many test calls to this phone; 403 — calls are not available on the plan.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) =>
      client.call<NotificationPhoneTestResponse>({
        method: 'POST',
        path: `/v1/notification-phones/${id}/test-notify`,
      }),
  });

  registerTool(server, ctx, {
    name: 'notification_phone_test_result',
    title: 'Get the outcome of a test call',
    description:
      'Returns the status of a test call placed by `notification_phone_test`: `calling` — still going, `answered`, `no_answer` or `failed`.',
    inputSchema: {
      id: z.number().int().positive().describe('Phone id.'),
      call_id: z
        .number()
        .int()
        .positive()
        .describe('`call_id` returned by `notification_phone_test`.'),
    },
    handler: async ({ id, call_id }, { client }) =>
      client.call<NotificationPhoneTestResultResponse>({
        method: 'GET',
        path: `/v1/notification-phones/${id}/test-calls/${call_id}`,
      }),
  });

  registerTool(server, ctx, {
    name: 'notification_phone_remove',
    title: 'Remove a phone for outage calls',
    description:
      'Removes a phone from the account: it is no longer called in any project. Irreversible — to use the same number again, it must be added and confirmed in the Statuser panel once more.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) => {
      await client.call({
        method: 'DELETE',
        path: `/v1/notification-phones/${id}`,
      });
      return { deleted: true, id };
    },
  });
}
