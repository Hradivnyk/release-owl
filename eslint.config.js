import tseslint from 'typescript-eslint';
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import nodePlugin from 'eslint-plugin-n';
import securityPlugin from 'eslint-plugin-security';
import importPlugin from 'eslint-plugin-import-x';
import globals from 'globals';

// --- Architectural boundaries (fitness functions) ---------------------------
// These complement the ts-arch tests (tests/architecture/) with the two rules
// ts-arch cannot express. See docs/architecture-tests.md.

// Feature modules under src/modules.
const FEATURE_MODULES = [
  'subscriptions',
  'releases',
  'sagas',
  'outbox',
  'github',
  'notifications',
];

// Cross-module imports must go through the module's index.ts barrel. A sibling
// module's internal file is imported as `../<module>/<file>`; the barrel is
// `../<module>/index`. Using literal module names (not `*`) keeps `../../platform`
// and other non-module relative imports from matching. Negations allow the barrel.
const barrelOnlyPatterns = [
  {
    group: FEATURE_MODULES.flatMap((m) => [
      `../${m}/*`,
      `!../${m}/index.js`,
      `!../${m}/index.ts`,
    ]),
    message:
      'Import sibling feature modules only through their index.ts barrel, not their internal files.',
  },
];

// Infrastructure libraries the application/domain layer must not import directly.
const INFRA_LIBS = [
  'express',
  'knex',
  'pg',
  'amqplib',
  '@grpc/grpc-js',
  'nodemailer',
  'node-cron',
];

export default tseslint.config(
  // only linting our own code, not what the build tools have generated.
  {
    ignores: [
      '**/dist/**',
      'coverage/**',
      '.claude/**',
      'packages/proto/src/gen/**',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.ts'],
    extends: tseslint.configs.recommendedTypeChecked,
    plugins: {
      n: nodePlugin,
      security: securityPlugin,
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        // gives ESLint access to TypeScript types so that it can perform a deep analysis
        // of the code, rather than just a syntactic one.
        // tsconfig.eslint.json already extends tsconfig.json and adds the workspace
        // package `paths`, so listing both would cause src/ files to be matched by
        // tsconfig.json (no paths) first, making @release-owl/* unresolvable.
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // Disable base rules in favour of TypeScript versions
      'no-unused-vars': 'off',
      'require-await': 'off',
      'no-throw-literal': 'off',

      // Prohibits declaring variables or arguments that are not used anywhere.
      // But it ignores arguments that start with _
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/promise-function-async': 'error',

      'no-console': 'warn',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-async-promise-executor': 'error',
      // Prohibits the use of `await` inside loops.
      'no-await-in-loop': 'error',

      'n/no-deprecated-api': 'error',
      // checks whether the modules you are importing exist.
      'n/no-missing-import': 'off',

      'security/detect-non-literal-regexp': 'warn',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-eval-with-expression': 'error',

      'import/first': 'error',
      'import/no-duplicates': 'error',
    },
  },

  {
    files: ['.husky/**/*.mjs', 'scripts/**/*.cjs', '**/*.cjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    files: ['tests/**/*.ts', 'tests/**/*.js', '**/*.test.ts', '**/*.test.js'],
    languageOptions: {
      globals: { ...globals.jest },
    },
    rules: {
      'no-console': 'off',
      'n/no-missing-import': 'off',
      'security/detect-object-injection': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Jest mock patterns (e.g. expect(mock).toHaveBeenCalledWith, mock.calls[0])
      // routinely trigger these rules; disabling them in tests avoids noisy false positives.
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },

  {
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    rules: {
      'no-console': 'off',
      'no-await-in-loop': 'off',
      'n/no-missing-import': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Playwright types are resolved at runtime via its own module; these
      // rules produce false positives because typescript-eslint cannot fully
      // resolve the Playwright type graph through tsconfig.eslint.json.
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // Architectural boundary (invariant 7): cross-module imports only via the
  // module's index.ts barrel. Applies to every module file.
  {
    files: ['src/modules/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: barrelOnlyPatterns },
      ],
    },
  },

  // Architectural boundary (invariant 6): the application/domain layer must not
  // import infrastructure libraries directly — depend on a port instead
  // (e.g. src/platform/scheduler.ts wraps node-cron). Adapters (*.model.ts,
  // *-notifier.ts) are intentionally excluded — they *are* the infrastructure.
  // This block is more specific than the one above, so it re-states the barrel
  // patterns to keep invariant 7 in force for service/orchestrator files too.
  {
    files: ['src/modules/**/*.service.ts', 'src/modules/**/*.orchestrator.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: INFRA_LIBS.map((name) => ({
            name,
            message:
              'Application/domain layer must not import infrastructure libraries directly; depend on a port/abstraction (see src/platform).',
          })),
          patterns: barrelOnlyPatterns,
        },
      ],
    },
  },

  // prettierConfig at the end ensures that ESLint won't conflict with prettier
  // over indentation, quotes, semicolons, and so on.
  prettierConfig,
);
