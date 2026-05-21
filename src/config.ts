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
  | 'status-pages'
  | 'status-page-reports'
  | 'notifications';

export const ALL_TOOLSETS: readonly Toolset[] = [
  'account',
  'monitors',
  'incidents',
  'incident-comments',
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const apiKey = env[ENV_API_KEY]?.trim();
  if (!apiKey) {
    throw new ConfigError(
      `${ENV_API_KEY} is not set. Create an API key at https://statuser.cloud/my/account/api-keys and expose it as ${ENV_API_KEY} in your MCP client config.`,
    );
  }

  const baseUrl = (env[ENV_BASE_URL]?.trim() || BASE_URL_DEFAULT).replace(
    /\/+$/,
    '',
  );

  const allowWrite = parseBool(env[ENV_ALLOW_WRITE]);
  const toolsets = parseToolsets(env[ENV_TOOLSETS]);

  return { apiKey, baseUrl, allowWrite, toolsets };
}

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function parseToolsets(value: string | undefined): ReadonlySet<Toolset> {
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
      `${ENV_TOOLSETS} contains unknown toolsets: ${unknown.join(
        ', ',
      )}. Allowed values: ${ALL_TOOLSETS.join(', ')}, or "all".`,
    );
  }
  return new Set(requested as Toolset[]);
}
