const BASE_URL_DEFAULT = 'https://api.statuser.cloud';
const ENV_API_KEY = 'STATUSER_API_KEY';
const ENV_BASE_URL = 'STATUSER_API_URL';
const ENV_ALLOW_WRITE = 'STATUSER_ALLOW_WRITE';
const ENV_TOOLSETS = 'STATUSER_TOOLSETS';

export type Toolset =
  | 'account'
  | 'monitors'
  | 'incidents'
  | 'incident-comments'
  | 'projects'
  | 'status-pages'
  | 'status-page-reports'
  | 'notifications';

export const ALL_TOOLSETS: readonly Toolset[] = [
  'account',
  'monitors',
  'incidents',
  'incident-comments',
  'projects',
  'status-pages',
  'status-page-reports',
  'notifications',
] as const;

export interface ServerConfig {
  apiKey: string;
  baseUrl: string;
  allowWrite: boolean;
  toolsets: ReadonlySet<Toolset>;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface ConfigInput {
  apiKey: string;
  baseUrl?: string;
  allowWrite?: boolean;
  toolsets?: ReadonlySet<Toolset>;
}

/**
 * Transport-agnostic config: the stdio entrypoint feeds it from the
 * environment, the HTTP one from the incoming request.
 */
export function buildConfig(input: ConfigInput): ServerConfig {
  return {
    apiKey: input.apiKey,
    baseUrl: (input.baseUrl?.trim() || BASE_URL_DEFAULT).replace(/\/+$/, ''),
    allowWrite: input.allowWrite ?? false,
    toolsets: input.toolsets ?? new Set(ALL_TOOLSETS),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const apiKey = env[ENV_API_KEY]?.trim();
  if (!apiKey) {
    throw new ConfigError(
      `${ENV_API_KEY} is not set. Create an API key at https://statuser.cloud/my/account/api-keys and expose it as ${ENV_API_KEY} in your MCP client config.`,
    );
  }

  return buildConfig({
    apiKey,
    baseUrl: env[ENV_BASE_URL],
    allowWrite: parseBool(env[ENV_ALLOW_WRITE]),
    toolsets: parseToolsets(env[ENV_TOOLSETS]),
  });
}

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * `source` names where the value came from, so the error points the user at
 * the right place: an env variable for stdio, a query parameter for HTTP.
 */
export function parseToolsets(
  value: string | undefined,
  source: string = ENV_TOOLSETS,
): ReadonlySet<Toolset> {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') {
    return new Set(ALL_TOOLSETS);
  }
  const known = new Set(ALL_TOOLSETS) as Set<string>;
  const requested = trimmed
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const unknown = requested.filter((name) => !known.has(name));
  if (unknown.length) {
    throw new ConfigError(
      `${source} contains unknown toolsets: ${unknown.join(
        ', ',
      )}. Allowed values: ${ALL_TOOLSETS.join(', ')}, or "all".`,
    );
  }
  return new Set(requested as Toolset[]);
}
