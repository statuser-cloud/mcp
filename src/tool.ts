import { z, type ZodTypeAny } from 'zod';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StatuserClient } from './client.js';
import type { ServerConfig } from './config.js';
import {
  StatuserApiError,
  WriteNotAllowedError,
  formatUnknownError,
} from './errors.js';

/**
 * `stdio` runs on the user's machine; `http` runs on ours. Anything a tool
 * does to the local machine — reading a path, writing a file — means our
 * server over HTTP.
 */
export type TransportKind = 'stdio' | 'http';

/** How a tool call ended; a closed set, so the hosted endpoint can count it. */
export type ToolOutcome =
  | 'ok'
  | 'refused'
  | 'invalid_args'
  | 'api_4xx'
  | 'api_5xx'
  | 'error';

function classifyFailure(err: unknown): ToolOutcome {
  if (err instanceof WriteNotAllowedError) return 'refused';
  if (err instanceof z.ZodError) return 'invalid_args';
  if (err instanceof StatuserApiError) {
    return err.status >= 500 ? 'api_5xx' : 'api_4xx';
  }
  return 'error';
}

export interface ToolContext {
  client: StatuserClient;
  config: ServerConfig;
  transport: TransportKind;
}

export interface ToolDefinition<Input extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  /**
   * Marks a tool as performing a write/destructive operation.
   * These tools are gated behind STATUSER_ALLOW_WRITE=1 or per-call { confirm: true }.
   */
  write?: boolean;
  /**
   * Touches the local filesystem. Registered over stdio only: over HTTP a
   * path argument would read files of our server, not of the caller.
   */
  localOnly?: boolean;
  /**
   * Zod schema for input fields. `confirm` is added automatically for write tools.
   */
  inputSchema: Input;
  /**
   * Handler. Receives parsed args and tool context. Should return either a
   * plain object (will be JSON-stringified into a text content block) or a
   * string (used verbatim).
   */
  handler: (
    args: z.objectOutputType<Input, ZodTypeAny>,
    ctx: ToolContext,
  ) => Promise<unknown>;
}

function confirmField(transport: TransportKind) {
  return z
    .boolean()
    .optional()
    .describe(
      transport === 'stdio'
        ? 'Set to true to authorize this write/destructive call even if STATUSER_ALLOW_WRITE is not enabled in the server config. Required for one-off overrides.'
        : 'Set to true to authorize this write/destructive call.',
    );
}

export function registerTool<Input extends z.ZodRawShape>(
  server: McpServer,
  ctx: ToolContext,
  def: ToolDefinition<Input>,
): void {
  if (def.localOnly && ctx.transport !== 'stdio') return;

  const schema: z.ZodRawShape = def.write
    ? { ...def.inputSchema, confirm: confirmField(ctx.transport) }
    : def.inputSchema;

  server.registerTool(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: schema,
      annotations: def.write
        ? {
            destructiveHint: true,
            readOnlyHint: false,
            openWorldHint: true,
          }
        : {
            readOnlyHint: true,
            openWorldHint: true,
          },
    },
    async (rawArgs: Record<string, unknown>) => {
      const started = performance.now();
      const report = (outcome: ToolOutcome, error?: unknown) =>
        ctx.config.onToolCall?.(
          def.name,
          outcome,
          (performance.now() - started) / 1000,
          error,
        );
      try {
        if (def.write) {
          const confirmed =
            ctx.config.allowWrite === true || rawArgs?.confirm === true;
          if (!confirmed) {
            throw new WriteNotAllowedError(def.name, ctx.transport);
          }
        }
        const args = z.object(def.inputSchema).parse(rawArgs ?? {});
        const result = await def.handler(args, ctx);
        report('ok');
        return toToolResult(result);
      } catch (err) {
        report(classifyFailure(err), err);
        return {
          isError: true as const,
          content: [
            {
              type: 'text' as const,
              text: formatUnknownError(err),
            },
          ],
        };
      }
    },
  );
}

function toToolResult(value: unknown): {
  content: Array<{ type: 'text'; text: string }>;
} {
  if (value === null || value === undefined) {
    return { content: [{ type: 'text', text: 'OK' }] };
  }
  if (typeof value === 'string') {
    return { content: [{ type: 'text', text: value }] };
  }
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}
