import type { paths, components, operations } from './openapi.js';

/**
 * Convenience helpers for extracting types from the generated openapi.ts.
 *
 * Intended usage in curated tools:
 *
 *   type CreateMonitorBody = RequestBody<'/v1/servers', 'post'>;
 *   handler: async (args, { client }) => {
 *     const body: CreateMonitorBody = args; // compile-time check
 *     return client.call({ method: 'POST', path: '/v1/servers', body });
 *   }
 *
 * What these types catch:
 *
 *   - typos in field names (`name` vs `file_name`);
 *   - outdated enum values (e.g. `http_method: "delete"` that no longer exists);
 *   - any change in request body shape after a backend update.
 *
 * Runtime validation still lives in the per-tool zod schemas. The generated
 * types are a build-time safety net on top of that.
 */

export type Schemas = components['schemas'];

/** Schema by `components.schemas.<Name>`. */
export type Schema<Name extends keyof Schemas> = Schemas[Name];

/** All HTTP methods supported by openapi-typescript paths. */
type AnyMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head';

/** Extract typed JSON request body for a (path, method) pair. */
export type RequestBody<
  P extends keyof paths,
  M extends AnyMethod & keyof paths[P],
> = paths[P][M] extends {
  requestBody?: { content: { 'application/json': infer Body } };
}
  ? Body
  : never;

/** Extract typed JSON response body for a (path, method, status) tuple. */
export type ResponseBody<
  P extends keyof paths,
  M extends AnyMethod & keyof paths[P],
  S extends number = 200,
> = paths[P][M] extends { responses: infer R }
  ? S extends keyof R
    ? R[S] extends { content: { 'application/json': infer Body } }
      ? Body
      : never
    : never
  : never;

/**
 * Typed JSON response body for whichever 2xx status the endpoint advertises:
 * 200, then 201. Use this instead of `ResponseBody` when you do not care which
 * specific success status is returned (most endpoints).
 */
export type OkResponseBody<
  P extends keyof paths,
  M extends AnyMethod & keyof paths[P],
> = [ResponseBody<P, M, 200>] extends [never]
  ? ResponseBody<P, M, 201>
  : ResponseBody<P, M, 200>;

/** Re-export of operations for explicit references when needed. */
export type Operations = operations;
