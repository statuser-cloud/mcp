export interface StatuserApiErrorBody {
  status?: number;
  error_code?: string;
  message?: string;
  meta?: Record<string, unknown>;
}

export class StatuserApiError extends Error {
  readonly status: number;
  readonly errorCode: string | undefined;
  readonly meta: Record<string, unknown> | undefined;

  constructor(
    status: number,
    message: string,
    errorCode?: string,
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'StatuserApiError';
    this.status = status;
    this.errorCode = errorCode;
    this.meta = meta;
  }

  toToolMessage(): string {
    const parts = [`Statuser API ${this.status}`];
    if (this.errorCode) parts.push(`(${this.errorCode})`);
    parts.push(`: ${this.message}`);
    if (this.meta && Object.keys(this.meta).length) {
      parts.push(`\nmeta: ${JSON.stringify(this.meta)}`);
    }
    return parts.join('');
  }
}

export class WriteNotAllowedError extends Error {
  constructor(toolName: string) {
    super(
      `Refusing to call "${toolName}": this tool performs a write/destructive operation, but STATUSER_ALLOW_WRITE is not enabled. ` +
        `Set STATUSER_ALLOW_WRITE=1 in the MCP client config, or pass { confirm: true } as a tool argument for a one-off override.`,
    );
    this.name = 'WriteNotAllowedError';
  }
}

export function formatUnknownError(err: unknown): string {
  if (err instanceof StatuserApiError) return err.toToolMessage();
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
