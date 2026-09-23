# @statuser/mcp — notes for Claude

An MCP server on top of the public Statuser API: hand-curated tools over types
generated from the production OpenAPI spec, served over two transports from one
`createServer()` (`src/server.ts`) — stdio for `npx` on the user's machine and
stateless Streamable HTTP (`src/http/`) for the hosted endpoint. Published to npm as
`@statuser/mcp` with provenance. **This repository is public** — non-public data
(internal accounts, credentials, internal addresses) and links to private
repositories never land in repo files, comments included.

## Language

- **Commits, PRs, branch names and code comments — English only.** The repo is
  public and its history is read from the outside. Other repositories in this
  project are kept in Russian — do not carry that habit across repos.
- README and user-facing docs — Russian (that is the audience).
- Tool `description`/`title` and error text — English: they end up in the LLM
  context inside the user's client.

## Never edit by hand

`spec/openapi.json` and `src/generated/openapi.ts` are output of
`npm run fetch-spec` (pulls `/swagger-json` from production). Hand edits are
overwritten by the next sync. Need different behaviour — change the API on your
side, then sync. `src/generated/helpers.ts` is hand-written and fine to edit.

## Release cycle

1. `sync-spec.yml` runs on `repository_dispatch: backend-deployed`, sent by the
   API's CI after a successful production deploy, plus a safety-net cron at
   06:00 UTC and a manual trigger.
2. If the spec changed, a `chore/sync-spec` PR against `main` is opened with a
   patch version bump. A **breaking change** (removed endpoint, renamed field,
   narrowed enum) needs a manual minor/major bump in that same PR — the
   auto-bump does not detect one.
3. After the merge the tag is pushed **by hand**, and the tag is what triggers
   publishing:
   `git pull && git tag "v$(jq -r .version package.json)" && git push --tags`.
   The version in `package.json` must match the tag — `publish.yml` gates on it.

The same tag also builds the container image of the hosted HTTP endpoint
(`image` job in `publish.yml`, `ghcr.io/statuser-cloud/statuser-mcp:<version>`),
and only after the npm publish succeeded. The deployment pins that version
and is updated separately — this repository holds no cluster credentials, keep
it that way.

**Never move a published `v*` tag.** npm refuses to republish the same version,
and provenance breaks on a moved tag. Got a release wrong — ship the next
version instead of repointing the tag.

A field added to the API shows up in the tools only once that API is **deployed
to production**: the spec is pulled from production, not from sources.

## Adding a tool

- Register through `registerTool` from `src/tool.ts` in `src/tools/<domain>.ts`,
  and wire it up in `src/index.ts` under the right toolset.
- A new toolset also goes into `src/config.ts` — the `Toolset` type and
  `ALL_TOOLSETS` (otherwise `STATUSER_TOOLSETS` rejects it as unknown).
- Take request/response types from `RequestBody<path, method>` and
  `OkResponseBody<path, method>` in `generated/helpers.ts`: they catch field
  typos and stale enums at build time. Runtime validation stays with zod.
- An enum copied into a zod schema by hand must be pinned to the spec with
  `type _X = Expect<SameValues<z.infer<typeof myEnum>, SpecEnum<Field>>>`
  (`generated/helpers.ts`). A typed request body catches a value the API
  dropped but not one it added, so an unpinned copy falls behind silently —
  that is how `project` went missing from the activity log filter and
  `blocklist_alerts` from notification rules and webhooks. A value left out on
  purpose is subtracted explicitly (`Exclude<…, 'support'>`) with the reason
  next to it. Path segments such as `/v1/servers/{id}/{action}` are plain
  strings in the spec and cannot be pinned.
- Put the constraints in `description` instead of restating the name: what gates
  availability (a plan feature), how deep the history goes, which parameters are
  mutually exclusive. The assistant picks a tool by that text — see
  `incident_list` in `src/tools/incidents.ts` for the tone.

## Tools that touch the local machine

Over HTTP the server runs on **our** infrastructure, so "local" means our pod.
A tool argument holding a file path would let any key owner read our files —
the service account token, `/proc/self/environ` with internal secrets — and
download them back as an incident attachment. Rules:

- A tool that reads or writes the filesystem is `localOnly: true`: it is not
  registered over HTTP at all.
- A path-like field on a tool that otherwise works remotely is added to the
  schema only when `ctx.transport === 'stdio'` (see `attached_local_files` in
  `src/tools/incident-comments.ts`). Zod strips fields missing from the schema,
  so a client cannot smuggle it in; the helper that reads the file refuses
  outside stdio as a second line of defence.
- The same goes for fetching an arbitrary URL from a tool argument: over HTTP
  that is a request from inside our network.

## Write tools

Every mutation must be `write: true`. The flag does three things: it enables the
gate (`STATUSER_ALLOW_WRITE=1` in the server config, or `confirm: true` on an
individual call), adds a `confirm` field to the schema, and sets
`destructiveHint`/`readOnlyHint` in the annotations. Forgetting the flag means
letting an assistant silently delete a user's object.

## Before a PR

Run the same four steps CI runs (`publish.yml`, `sync-spec.yml`) locally —
otherwise the release breaks after the merge:

```bash
npm run typecheck && npm run lint && npm run format:check && npm run build
```

## Git

Do not commit, push or merge without an explicit instruction.
