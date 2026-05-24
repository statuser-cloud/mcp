import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

/**
 * ESLint flat config for @statuser/mcp.
 *
 * Goals:
 *   - Catch real correctness issues (unused vars, missing await, no-explicit-any).
 *   - Keep style decisions to Prettier — `eslint-config-prettier` disables any
 *     stylistic rules that would otherwise conflict.
 *   - Skip type-aware rules. They overlap with `npm run typecheck` (tsc),
 *     and they require a separate ESLint tsconfig because our build config
 *     does not include the `scripts/` folder.
 *   - Ignore generated artefacts (`dist/`, `src/generated/`).
 */
export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/generated/**',
      'spec/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        // `globals.node` exposes runtime values; TS-only namespaces from
        // @types/node (NodeJS.ProcessEnv, NodeJS.Timeout, etc.) still need
        // to be whitelisted for the `no-undef` rule.
        NodeJS: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // Allow `_`-prefixed unused vars (handler args, intentional ignores).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Prefer `import type { ... }` for type-only imports — keeps the
      // emitted JS smaller and helps tree-shaking.
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // `any` shows up in pragmatic places (third-party shims). Warn, not error.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Built-in `no-unused-vars` would double-fire with the TS one above.
      'no-unused-vars': 'off',
    },
  },
  prettierConfig,
];
