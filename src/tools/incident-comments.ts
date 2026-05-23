import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { request as undiciRequest } from 'undici';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolContext } from '../tool.js';
import type { RequestBody } from '../generated/helpers.js';

type IncidentCommentCreateBody = RequestBody<
  '/v1/incidents/{incidentId}/comments',
  'post'
>;
type IncidentCommentUpdateBody = RequestBody<
  '/v1/incidents/{incidentId}/comments/{commentId}',
  'patch'
>;
type IncidentCommentUploadUrlBody = RequestBody<
  '/v1/incidents/{incidentId}/comments/upload-url',
  'post'
>;

const attachmentInput = z.object({
  url: z
    .string()
    .url()
    .describe(
      'Public URL of a previously uploaded attachment (returned by `incident_comment_upload_file` as `file_url`).',
    ),
  file_name: z
    .string()
    .min(1)
    .max(255)
    .describe('Display name of the file as it will appear in the comment.'),
});

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.json': 'application/json',
  '.har': 'application/json',
  '.zip': 'application/zip',
};

export function registerIncidentCommentTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerTool(server, ctx, {
    name: 'incident_comment_list',
    title: 'List incident comments',
    description:
      'Lists all comments on an incident in chronological order, including attached files and timestamps.',
    inputSchema: {
      incident_id: z.number().int().positive(),
    },
    handler: async ({ incident_id }, { client }) =>
      client.call({
        method: 'GET',
        path: `/v1/incidents/${incident_id}/comments`,
      }),
  });

  registerTool(server, ctx, {
    name: 'incident_comment_create',
    title: 'Create incident comment',
    description:
      'Adds a text comment to an incident. To attach files: either pass URLs already issued via `incident_comment_upload_file`, or pass local file paths in `attached_local_files` and the tool will upload them first. Requires `incident_comments_enabled` on the plan.',
    write: true,
    inputSchema: {
      incident_id: z.number().int().positive(),
      comment_text: z.string().min(1),
      attached_files: z.array(attachmentInput).optional(),
      attached_local_files: z
        .array(z.string())
        .optional()
        .describe(
          'Local absolute paths to upload as attachments before posting the comment. Combined with `attached_files`.',
        ),
    },
    handler: async (
      { incident_id, comment_text, attached_files, attached_local_files },
      ctx2,
    ) => {
      const uploaded = await uploadLocalFiles(
        ctx2,
        incident_id,
        attached_local_files ?? [],
      );
      const allFiles = [...(attached_files ?? []), ...uploaded];
      const body: IncidentCommentCreateBody = {
        comment_text,
        attached_files: allFiles.length ? allFiles : undefined,
      };
      return ctx2.client.call({
        method: 'POST',
        path: `/v1/incidents/${incident_id}/comments`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'incident_comment_update',
    title: 'Update incident comment',
    description:
      'Edits text and/or attachments of an existing comment. If `attached_files` is provided, it fully replaces the previous list — files not in the new list are deleted from storage.',
    write: true,
    inputSchema: {
      incident_id: z.number().int().positive(),
      comment_id: z.number().int().positive(),
      comment_text: z.string().optional(),
      attached_files: z.array(attachmentInput).optional(),
    },
    handler: async (
      { incident_id, comment_id, ...patch },
      { client },
    ) => {
      const body: IncidentCommentUpdateBody = patch;
      return client.call({
        method: 'PATCH',
        path: `/v1/incidents/${incident_id}/comments/${comment_id}`,
        body,
      });
    },
  });

  registerTool(server, ctx, {
    name: 'incident_comment_delete',
    title: 'Delete incident comment',
    description:
      'Permanently deletes a comment along with all attached files. Irreversible — neither comment nor files can be recovered.',
    write: true,
    inputSchema: {
      incident_id: z.number().int().positive(),
      comment_id: z.number().int().positive(),
    },
    handler: async ({ incident_id, comment_id }, { client }) => {
      await client.call({
        method: 'DELETE',
        path: `/v1/incidents/${incident_id}/comments/${comment_id}`,
      });
      return { deleted: true, comment_id };
    },
  });

  registerTool(server, ctx, {
    name: 'incident_comment_upload_file',
    title: 'Upload a file to attach to a comment',
    description:
      'Two-step file upload: requests an upload URL from Statuser, PUTs the local file there, and returns the public `file_url` you can pass into `incident_comment_create` / `incident_comment_update` as an attachment. Size limit: 5 MB.',
    write: true,
    inputSchema: {
      incident_id: z.number().int().positive(),
      local_path: z.string().describe('Absolute path to a local file.'),
    },
    handler: async ({ incident_id, local_path }, ctx2) => {
      const uploaded = await uploadLocalFiles(ctx2, incident_id, [local_path]);
      return uploaded[0];
    },
  });
}

async function uploadLocalFiles(
  ctx: ToolContext,
  incidentId: number,
  paths: string[],
): Promise<Array<{ url: string; file_name: string }>> {
  if (!paths.length) return [];
  const results: Array<{ url: string; file_name: string }> = [];

  for (const path of paths) {
    const bytes = await readFile(path);
    const fileName = basename(path);
    const ext = extname(fileName).toLowerCase();
    const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';

    const uploadBody: IncidentCommentUploadUrlBody = {
      file_name: fileName,
      content_type: contentType,
      file_size: bytes.byteLength,
    };
    const presigned = await ctx.client.call<{
      uploadUrl: string;
      fileUrl: string;
    }>({
      method: 'POST',
      path: `/v1/incidents/${incidentId}/comments/upload-url`,
      body: uploadBody,
    });

    const res = await undiciRequest(presigned.uploadUrl, {
      method: 'PUT',
      body: bytes,
      headers: { 'content-type': contentType },
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const text = await res.body.text();
      throw new Error(
        `Failed to upload "${fileName}": HTTP ${res.statusCode} ${text.slice(0, 200)}`,
      );
    } else {
      await res.body.dump();
    }

    results.push({ url: presigned.fileUrl, file_name: fileName });
  }

  return results;
}
