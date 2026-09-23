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

/** Extract typed query parameters for a (path, method) pair. */
export type QueryParams<
  P extends keyof paths,
  M extends AnyMethod & keyof paths[P],
> = paths[P][M] extends { parameters: { query?: infer Q } }
  ? NonNullable<Q>
  : never;

/**
 * The values of a spec enum field, whether the field holds one value or an
 * array of them, without `null`/`undefined`: `SpecEnum<'a' | 'b' | undefined>`
 * and `SpecEnum<('a' | 'b')[]>` are both `'a' | 'b'`.
 */
export type SpecEnum<T> =
  NonNullable<T> extends readonly (infer E)[]
    ? NonNullable<E>
    : NonNullable<T>;

/**
 * `true` when a hand-written enum lists exactly the values of a spec union;
 * otherwise an object naming the difference, which `Expect` rejects with those
 * values in the build error.
 *
 * Why it exists: a typed request body catches a value the spec dropped, but
 * not one the spec added — so a zod enum copied by hand silently falls behind
 * the API (that is how `project` went missing from the activity log filter).
 *
 *   type _Check = Expect<SameValues<z.infer<typeof myEnum>, SpecEnum<Field>>>;
 */
export type SameValues<Tool, Spec> = [
  Exclude<Spec, Tool>,
  Exclude<Tool, Spec>,
] extends [never, never]
  ? true
  : { missing_from_tool: Exclude<Spec, Tool>; not_in_spec: Exclude<Tool, Spec> };

/** Fails the build unless `T` is `true`. */
export type Expect<T extends true> = T;

/** Re-export of operations for explicit references when needed. */
export type Operations = operations;
