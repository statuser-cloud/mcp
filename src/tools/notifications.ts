import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from '../tool.js';
import type { RequestBody } from '../generated/helpers.js';

type WebhookCreateBody = RequestBody<'/v1/webhooks', 'post'>;
type WebhookUpdateBody = RequestBody<'/v1/webhooks/{id}', 'patch'>;
type NotificationRuleSetBody = RequestBody<'/v1/notification-rules', 'patch'>;
type NotificationEmailAddBody = RequestBody<'/v1/notification-emails', 'post'>;
type NotificationEmailConfirmBody = RequestBody<
  '/v1/notification-emails/{id}/confirm',
  'post'
>;

// All public subscription types — used for per-channel notification rules.
const notificationRuleSubscriptionEnum = z.enum([
  'updates',
  'weekly_reports',
  'service_alerts',
  'ssl_alerts',
  'domain_alerts',
  'dns_alerts',
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
  'ideas',
  'billing_alerts',
  'holiday_mode',
  'api_key_alerts',
  'security_alerts',
]);

export function registerNotificationTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  // ---------- Webhooks ----------

  registerTool(server, ctx, {
    name: 'webhook_list',
    title: 'List webhooks',
    description:
      'Lists all webhook endpoints configured on the account: name, URL, and the set of `subscriptions` (event types delivered to that webhook). The secret set on creation is not returned.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call({ method: 'GET', path: '/v1/webhooks' }),
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
        .describe('Signing secret. Pass `null` if you do not want signature.'),
      subscriptions: z.array(webhookSubscriptionEnum),
    },
    handler: async (args, { client }) => {
      const body: WebhookCreateBody = args;
      return client.call({ method: 'POST', path: '/v1/webhooks', body });
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
    },
    handler: async ({ id, ...patch }, { client }) => {
      const body: WebhookUpdateBody = patch;
      return client.call({ method: 'PATCH', path: `/v1/webhooks/${id}`, body });
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
      'Returns the current matrix of notification rules: for each subscription type (`service_alerts`, `ssl_alerts`, `domain_alerts`, `dns_alerts`, `weekly_reports`, `updates`, `billing_alerts`, `holiday_mode`, `api_key_alerts`, `security_alerts`, `ideas`) — three boolean flags `email` / `telegram` / `max` indicating whether that channel is enabled. Webhooks have their own per-webhook `subscriptions` field and do not appear here.',
    inputSchema: {},
    handler: async (_args, { client }) =>
      client.call({ method: 'GET', path: '/v1/notification-rules' }),
  });

  registerTool(server, ctx, {
    name: 'notification_rule_set',
    title: 'Set notification rule for a subscription type',
    description:
      'Creates or updates the rule for a single subscription type: toggles channels `email`, `telegram`, `max`. Selecting individual recipients/chats is not possible — these are account-wide on/off per channel. Returns the full updated list of rules.',
    write: true,
    inputSchema: {
      type: notificationRuleSubscriptionEnum,
      email: z.boolean(),
      telegram: z.boolean(),
      max: z.boolean(),
    },
    handler: async (args, { client }) => {
      const body: NotificationRuleSetBody = args;
      return client.call({
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
      client.call({ method: 'GET', path: '/v1/notification-emails' }),
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
      return client.call({
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
      return client.call({
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
}
