import { z, type ZodTypeAny } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StatuserClient } from './client.js';
import type { ServerConfig } from './config.js';
import { WriteNotAllowedError, formatUnknownError } from './errors.js';

export interface ToolContext {
  client: StatuserClient;
  config: ServerConfig;
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

const CONFIRM_FIELD = z
  .boolean()
  .optional()
  .describe(
    'Set to true to authorize this write/destructive call even if STATUSER_ALLOW_WRITE is not enabled in the server config. Required for one-off overrides.',
  );

export function registerTool<Input extends z.ZodRawShape>(
  server: McpServer,
  ctx: ToolContext,
  def: ToolDefinition<Input>,
): void {
  const schema: z.ZodRawShape = def.write
    ? { ...def.inputSchema, confirm: CONFIRM_FIELD }
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
      try {
        if (def.write) {
          const confirmed =
            ctx.config.allowWrite === true || rawArgs?.confirm === true;
          if (!confirmed) {
            throw new WriteNotAllowedError(def.name);
          }
        }
        const args = z.object(def.inputSchema).parse(rawArgs ?? {});
        const result = await def.handler(args, ctx);
        return toToolResult(result);
      } catch (err) {
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
