#!/usr/bin/env tsx
/**
 * Downloads the latest Statuser OpenAPI spec into spec/openapi.json
 * and regenerates src/generated/openapi.ts (TypeScript types only).
 *
 * Run manually after a backend release: `npm run fetch-spec`.
 * We commit both files so the package build is reproducible.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SPEC_URL =
  process.env.STATUSER_SPEC_URL ?? 'https://api.statuser.cloud/swagger-json';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const specPath = join(repoRoot, 'spec', 'openapi.json');
const typesPath = join(repoRoot, 'src', 'generated', 'openapi.ts');

async function main() {
  process.stdout.write(`Fetching ${SPEC_URL}...\n`);
  const res = await fetch(SPEC_URL, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch spec: HTTP ${res.status}`);
  }
  const spec = await res.json();

  await mkdir(dirname(specPath), { recursive: true });
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote ${specPath}\n`);

  await mkdir(dirname(typesPath), { recursive: true });
  const result = spawnSync(
    'npx',
    ['--yes', 'openapi-typescript@7', specPath, '-o', typesPath],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error('openapi-typescript failed');
  }

  // Strip JSDoc comment blocks that mirror spec descriptions.
  // The spec is single-language by design and currently targets Russian
  // users, so its `@description`/`@example` fields are in Russian. The
  // package's source comments are English-only by project convention, and
  // the TypeScript types themselves carry every piece of structural info
  // we need (optionality, enum values, nullability). The very first JSDoc
  // block in the file is the openapi-typescript header — that one stays.
  await stripJsdocBlocks(typesPath);

  process.stdout.write(`Wrote ${typesPath}\n`);
}

async function stripJsdocBlocks(path: string): Promise<void> {
  const source = await readFile(path, 'utf8');
  let kept = false;
  let stripped = source.replace(
    /[ \t]*\/\*\*[\s\S]*?\*\/[ \t]*\n?/g,
    (match) => {
      if (!kept) {
        kept = true;
        return match; // preserve the auto-generated file header
      }
      return '';
    },
  );
  // Collapse any blank-line runs left after stripping.
  stripped = stripped.replace(/\n{3,}/g, '\n\n');
  await writeFile(path, stripped, 'utf8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
