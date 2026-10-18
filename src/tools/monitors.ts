import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from '../tool.js';
import type {
  Expect,
  OkResponseBody,
  RequestBody,
  SameValues,
  SpecEnum,
} from '../generated/helpers.js';

/**
 * Compile-time guardrail: the request body sent to the backend must match
 * the types generated from the swagger spec. If the backend DTO shape
 * changes, TypeScript will flag the mismatch before the package is published.
 * The same idea applies to response shapes via OkResponseBody — if a backend
 * release renames or drops a field, every dependant client.call site lights up.
 */
type CreateMonitorBody = RequestBody<'/v1/servers', 'post'>;
type UpdateMonitorBody = RequestBody<'/v1/servers/{id}', 'patch'>;

type MonitorListResponse = OkResponseBody<'/v1/servers', 'get'>;
type MonitorResponse = OkResponseBody<'/v1/servers/{id}', 'get'>;
type MonitorCreateResponse = OkResponseBody<'/v1/servers', 'post'>;
type MonitorUpdateResponse = OkResponseBody<'/v1/servers/{id}', 'patch'>;
type MonitorPauseResponse = OkResponseBody<
  '/v1/servers/{id}/{action}',
  'patch'
>;
type MonitorChecksResponse = OkResponseBody<'/v1/servers/{id}/checks', 'get'>;
type MonitorHeartbeatResponse = OkResponseBody<
  '/v1/servers/{id}/heartbeat/events',
  'get'
>;
type MonitorDnsHistoryResponse = OkResponseBody<
  '/v1/servers/{id}/dns-history',
  'get'
>;
type ScenarioRunResponse = OkResponseBody<
  '/v1/servers/{id}/scenario-run',
  'post'
>;
type ScenarioRunLatestResponse = OkResponseBody<
  '/v1/servers/{id}/scenario-run/latest',
  'get'
>;

// Mirrors the public enum from PlanFeaturesResponseDto / ServerProtocol.
const protocolEnum = z.enum([
  'ping',
  'http',
  'keyword',
  'tcp',
  'dns',
  'heartbeat',
  'llm',
  'scenario',
]);

const locationEnum = z.enum(['msk-1', 'spb-1', 'ala-1', 'nyc-1', 'ams-1']);

const dnsRecordTypeEnum = z.enum([
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'TXT',
  'NS',
  'SOA',
  'PTR',
  'SRV',
]);

// Copied from the API; pinned so a new protocol, location or record type
// fails the build instead of being rejected by the tool.
type _ProtocolsMatchApi = Expect<
  SameValues<
    z.infer<typeof protocolEnum>,
    SpecEnum<CreateMonitorBody['protocol']>
  >
>;
type _LocationsMatchApi = Expect<
  SameValues<
    z.infer<typeof locationEnum>,
    SpecEnum<CreateMonitorBody['locations']>
  >
>;
type _DnsRecordTypesMatchApi = Expect<
  SameValues<
    z.infer<typeof dnsRecordTypeEnum>,
    SpecEnum<CreateMonitorBody['dns_record_types']>
  >
>;

const headerSchema = z.object({
  key: z.string(),
  value: z.string(),
});

const baseMonitorFields = {
  project_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Project the monitor belongs to. Omitted on create, it goes to the oldest project of the account; passed on update, the monitor MOVES there — it starts living by the notification rules and channels of the new project and disappears from the status pages of the old one. See `project_list`.',
    ),
  host: z
    .string()
    .describe(
      'Host to monitor: URL for http/keyword, hostname or IP for ping/tcp/dns, API endpoint for llm (domain, versioned base or a full method path — the method path is appended when missing). For heartbeat and scenario the address is assigned by the server: pass any non-empty string, e.g. the monitor name.',
    ),
  protocol: protocolEnum.describe(
    'Monitor type. SSL/domain checks are flags layered on top of `http`. `llm` watches an AI endpoint and is configured by the `llm_*` fields. `scenario` runs a Playwright test (`scenario_script`) in a real browser on schedule — for flows a single request cannot prove: logging in, a cart, a chain of API calls.',
  ),
  port: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .optional()
    .describe('Required for `tcp`.'),
  http_method: z
    .enum(['get', 'head', 'post', 'put', 'patch', 'options'])
    .optional()
    .describe(
      'HTTP method, applies to `http` and `keyword` protocols. Defaults to `head` there, as in the panel — the cheapest request that still proves the service answers.',
    ),
  body: z
    .string()
    .optional()
    .describe('Request body for `http`/`keyword`. Omit to leave empty.'),
  keyword: z
    .string()
    .max(256)
    .optional()
    .describe('Substring to look for on the page (for `keyword` protocol).'),
  keyword_mode: z
    .enum(['present', 'absent'])
    .optional()
    .describe('Whether the keyword should be present or absent.'),
  headers: z.array(headerSchema).optional(),
  is_follow_redirects: z
    .boolean()
    .optional()
    .describe(
      'Follow HTTP redirects. Defaults to true for `http`/`keyword` (what the panel does) and to false for the protocols where redirects mean nothing.',
    ),
  success_http_codes: z
    .array(z.string())
    .optional()
    .describe(
      'HTTP codes considered successful. Accepts exact codes (200, 301) and masks (2xx, 5xx).',
    ),
  request_timeout: z
    .number()
    .int()
    .min(1)
    .max(120)
    .optional()
    .describe(
      'Request timeout in seconds, 1–60. Defaults to 30, as in the panel. For `scenario` it is the limit for the whole run, one of 15, 30, 45, 60 or 120, and no more than `scenario_max_timeout_seconds` of the current plan.',
    ),
  check_interval: z
    .number()
    .int()
    .min(60)
    .optional()
    .describe(
      'Interval between checks in seconds. Defaults to 300 — the smallest value every plan allows. Anything shorter needs `min_check_interval_seconds` of the current plan to permit it (60 on paid plans). For `scenario` the floor is `scenario_min_check_interval_seconds` of the plan, the ceiling is 86400 (a day), and the default is 900.',
    ),
  heartbeat_grace_interval: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Additional grace period (in seconds) past `check_interval` for `heartbeat` monitors.',
    ),
  incident_confirm_delay: z
    .number()
    .int()
    .min(0)
    .max(3600)
    .optional()
    .describe(
      'Delay (in seconds, up to 1 hour) before an incident is opened: the service must stay down continuously for longer than this, otherwise short blips raise no incident and no alert. 0 (default) opens the incident on the first failed check. Requires `incident_debounce_enabled` on the current plan (Team).',
    ),
  name: z.string().max(150).optional(),
  description: z.string().max(500).optional(),
  is_ssl_check: z
    .boolean()
    .optional()
    .describe(
      'Watch the SSL certificate of the host. Defaults to false: it is a paid feature (`ssl_monitoring_enabled`), and turning it on by default would make creation fail on Free. Pass true to enable.',
    ),
  is_domain_check: z
    .boolean()
    .optional()
    .describe(
      'Watch the domain registration of the host. Defaults to false for the same reason as `is_ssl_check` (`domain_monitoring_enabled`).',
    ),
  is_blocklist_check: z
    .boolean()
    .optional()
    .describe(
      'Watch whether the domain appears in the Roskomnadzor (RKN) blocklist registry. Applies to `http`/`keyword`/`dns`. Requires `blocklist_monitoring_enabled` on the current plan.',
    ),
  is_latency_alert_enabled: z.boolean().optional(),
  latency_trigger_ms: z.number().int().min(50).max(60000).optional(),
  locations: z
    .array(locationEnum)
    .optional()
    .describe(
      'Locations to run checks from. Allowed values are the codes from `current_plan_get` -> `features.available_locations`. A `scenario` runs from exactly one location (defaults to `msk-1`): there is no fallback, because the address the site sees is often what the scenario checks — allowlists, geo blocks, prices.',
    ),
  dns_record_types: z
    .array(dnsRecordTypeEnum)
    .optional()
    .describe('Required for `dns` protocol.'),
  llm_provider: z
    .enum(['openai_compatible', 'anthropic_compatible'])
    .optional()
    .describe(
      'API dialect of the endpoint. Required for `llm`. It selects the method path, auth header, body format and success marker only — the address always comes from `host`. `openai_compatible` fits OpenAI itself and the gateways that copy its API.',
    ),
  llm_model: z
    .string()
    .max(128)
    .optional()
    .describe(
      'Model identifier, for `llm`. Required together with `llm_api_key` and pointless without it: with no key the check probes only endpoint availability and no model is involved.',
    ),
  llm_api_key: z
    .string()
    .max(512)
    .nullable()
    .optional()
    .describe(
      'Provider API key, for `llm`. Its presence picks the check mode: with a key the monitor sends the model a real one-token request and verifies the answer (`inference` — billed by the provider, requires `ai_inference_enabled` on the plan); without a key only endpoint availability is checked (`availability`, spends no tokens). On update omit the field to keep the stored key, pass `null` to delete it and fall back to availability, pass a string to replace it. Stored encrypted and never returned: responses carry only `llm_api_key_masked`.',
    ),
  scenario_script: z
    .string()
    .max(65536)
    .optional()
    .describe(
      'Playwright test in JavaScript or TypeScript, one file, using `test` and `expect` from `@playwright/test`. Required for `scenario`. The run fails if any test fails. Locate elements by role and label (`getByRole`, `getByLabel`), put an `expect` after every important step, read logins and passwords from `process.env`, and leave out `playwright.config` and per-step timeouts — Statuser sets them. Every run starts in a fresh browser with no cookies. Requires `scenarios_limit` above zero on the current plan (Pro and Team). Before relying on it, suggest trying the script with the Run button (Запустить) in the panel form: a selector guessed without seeing the page is the usual reason a new scenario fails.',
    ),
  scenario_env: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Environment variables of the scenario — logins, passwords, tokens — read in the script as `process.env.NAME`. Names are upper-case Latin letters, digits and `_`; up to 20 variables, 4 KB each. Stored encrypted and never returned: responses carry only the names (`scenario_env_keys`). A typed password is visible in the run trace, so suggest a dedicated account with minimal rights.',
    ),
};

export function registerMonitorTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerTool(server, ctx, {
    name: 'monitor_list',
    title: 'List monitors',
    description:
      'Lists every monitor on the account with current status and configuration. Use `limit`/`offset` to paginate — recommended for accounts with many monitors.',
    inputSchema: {
      limit: z.number().int().min(1).optional(),
      offset: z.number().int().min(0).optional(),
      project_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Only monitors of this project. Omitted, the whole account is returned — that is the default and it stays so for compatibility.',
        ),
    },
    handler: async ({ limit, offset, project_id }, { client }) =>
      client.call<MonitorListResponse>({
        method: 'GET',
        path: '/v1/servers',
        query: { limit, offset, project_id },
      }),
  });

  registerTool(server, ctx, {
    name: 'monitor_get',
    title: 'Get monitor',
    description:
      'Returns full configuration and latest status for one monitor by id.',
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) =>
      client.call<MonitorResponse>({
        method: 'GET',
        path: `/v1/servers/${id}`,
      }),
  });

  registerTool(server, ctx, {
    name: 'monitor_create',
    title: 'Create monitor',
    description:
      'Creates a new monitor. Only `host` and `protocol` are required (plus `scenario_script` for `scenario`) — timeout, interval and redirect handling fall back to the same defaults the panel uses (30 s, 300 s — 900 s for a scenario, redirects followed for `http`/`keyword`), and the paid SSL and domain checks stay off unless asked for. Returns 403 if the account is over the servers limit or if a requested feature is not on the current plan (DNS/keyword/heartbeat, AI monitoring and its model response check as two separate gates, scenarios with their own limit, minimum interval and maximum timeout, latency alerts, custom success codes, non-default locations, blocklist monitoring, incident confirmation delay).',
    write: true,
    inputSchema: baseMonitorFields,
    handler: async (args, { client }) => {
      // The API marks these five as required with no defaults of its own, so
      // the tool used to demand all of them even for a heartbeat, where
      // redirects and certificates mean nothing — a plain «add example.com to
      // monitoring» failed on validation before reaching the API. Defaults
      // mirror the panel's add form, except the two paid checks: those stay
      // off, otherwise creation would fail on Free.
      const isHttpLike =
        args.protocol === 'http' || args.protocol === 'keyword';
      // 300 s is below the scenario floor on every plan (600 s on Team,
      // 900 s on Pro), so the general default would fail with 403.
      const defaultInterval = args.protocol === 'scenario' ? 900 : 300;
      const body: CreateMonitorBody = {
        ...args,
        // The API rejects http/keyword without a method, and the panel starts
        // with HEAD — the cheapest request that still proves the service
        // answers.
        http_method: args.http_method ?? (isHttpLike ? 'head' : undefined),
        is_follow_redirects: args.is_follow_redirects ?? isHttpLike,
        request_timeout: args.request_timeout ?? 30,
        check_interval: args.check_interval ?? defaultInterval,
        is_ssl_check: args.is_ssl_check ?? false,
        is_domain_check: args.is_domain_check ?? false,
      };
      return client.call<MonitorCreateResponse>({
        method: 'POST',
        path: '/v1/servers',
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'monitor_update',
    title: 'Update monitor',
    description:
      'Partial update: pass only the fields you want to change. Plan-feature constraints from `monitor_create` apply on update too.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
      ...Object.fromEntries(
        Object.entries(baseMonitorFields).map(([k, v]) => [
          k,
          (v as z.ZodTypeAny).optional(),
        ]),
      ),
      scenario_env: z
        .record(z.string(), z.string().nullable())
        .optional()
        .describe(
          'Partial edit of the scenario environment variables: a string sets a variable, `null` removes it, a name left out keeps its stored value. Values are never returned, so to keep a secret simply do not mention it. A typed password is visible in the run trace, so suggest a dedicated account with minimal rights.',
        ),
    },
    handler: async ({ id, ...patch }, { client }) => {
      const body: UpdateMonitorBody = patch;
      return client.call<MonitorUpdateResponse>({
        method: 'PATCH',
        path: `/v1/servers/${id}`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'monitor_pause',
    title: 'Pause or resume monitor',
    description:
      'Pauses (`action = "pause"`) or resumes (`action = "unpause"`) checks for a monitor without deleting its configuration or history. On resume, plan-feature gating is re-evaluated.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
      action: z.enum(['pause', 'unpause']),
    },
    handler: async ({ id, action }, { client }) =>
      client.call<MonitorPauseResponse>({
        method: 'PATCH',
        path: `/v1/servers/${id}/${action}`,
      }),
  });

  registerTool(server, ctx, {
    name: 'monitor_delete',
    title: 'Delete monitor',
    description:
      'Permanently deletes a monitor with its history, incidents and alert settings. Irreversible. To pause checks temporarily, use `monitor_pause` instead.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) => {
      await client.call({ method: 'DELETE', path: `/v1/servers/${id}` });
      return { deleted: true, id };
    },
  });

  registerTool(server, ctx, {
    name: 'monitor_test_notify',
    title: 'Send test notification for monitor',
    description:
      'Fires a test notification through all channels configured for this account (email/Telegram/MAX per notification rules + webhooks subscribed to the matching type). Useful for verifying delivery without waiting for a real incident.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) => {
      await client.call({
        method: 'POST',
        path: `/v1/servers/${id}/test-notify`,
      });
      return { sent: true, id };
    },
  });

  registerTool(server, ctx, {
    name: 'monitor_run_scenario',
    title: 'Run scenario now',
    description:
      'Runs the saved Playwright test of a `scenario` monitor now, off schedule, with the same consequences as a scheduled run: a point on the graph, and an incident opened or closed. Waits for the run to finish — up to the monitor `request_timeout` plus browser start-up — and returns the verdict, the failed test, the Playwright error and the test console output. The screenshot, video and trace links in the response work for an hour. One on-demand run per account at a time and at most 30 in 10 minutes (409 and 429 otherwise). If the client gives up waiting, `monitor_get_scenario_run_latest` returns the result.',
    write: true,
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) =>
      client.call<ScenarioRunResponse>({
        method: 'POST',
        path: `/v1/servers/${id}/scenario-run`,
      }),
  });

  registerTool(server, ctx, {
    name: 'monitor_get_scenario_run_latest',
    title: 'Get latest on-demand scenario run',
    description:
      'Whether an on-demand run started by `monitor_run_scenario` is still going, and its result once it finished within the last hour. Scheduled runs are not here: their outcome is the graph (`monitor_get_checks`) and, for a failure, the incident diagnostics (`incident_get_scenario_details`).',
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) =>
      client.call<ScenarioRunLatestResponse>({
        method: 'GET',
        path: `/v1/servers/${id}/scenario-run/latest`,
      }),
  });

  registerTool(server, ctx, {
    name: 'monitor_get_checks',
    title: 'Get monitor checks (aggregated)',
    description:
      'Returns aggregated check results for the period, suitable for uptime/latency graphs. Defaults to the last 24h if `start_date`/`end_date` are omitted. For day-scale periods, the response also contains the last few raw points to keep the graph interactive between aggregation intervals.',
    inputSchema: {
      id: z.number().int().positive(),
      start_date: z
        .string()
        .optional()
        .describe('ISO 8601 timestamp (inclusive). Default: now - 24h.'),
      end_date: z
        .string()
        .optional()
        .describe('ISO 8601 timestamp (exclusive). Default: now.'),
    },
    handler: async ({ id, start_date, end_date }, { client }) =>
      client.call<MonitorChecksResponse>({
        method: 'GET',
        path: `/v1/servers/${id}/checks`,
        query: { startDate: start_date, endDate: end_date },
      }),
  });

  registerTool(server, ctx, {
    name: 'monitor_get_heartbeat_events',
    title: 'Get heartbeat events',
    description:
      'Returns heartbeat events (pings from an external system) aggregated into equal intervals over the period. Only meaningful for monitors with `protocol = "heartbeat"`; others return an empty array. Defaults to the last 24h.',
    inputSchema: {
      id: z.number().int().positive(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
    },
    handler: async ({ id, start_date, end_date }, { client }) =>
      client.call<MonitorHeartbeatResponse>({
        method: 'GET',
        path: `/v1/servers/${id}/heartbeat/events`,
        query: { startDate: start_date, endDate: end_date },
      }),
  });

  registerTool(server, ctx, {
    name: 'monitor_get_dns_history',
    title: 'Get DNS-record history',
    description:
      'Returns diffs of DNS records observed by the monitor: what was added, what was removed, per record type. History depth is limited by the `dns_history_retention_days` plan feature. Only populated for monitors with `protocol = "dns"`; others return an empty array.',
    inputSchema: {
      id: z.number().int().positive(),
    },
    handler: async ({ id }, { client }) =>
      client.call<MonitorDnsHistoryResponse>({
        method: 'GET',
        path: `/v1/servers/${id}/dns-history`,
      }),
  });
}
