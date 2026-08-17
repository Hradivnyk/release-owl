import tseslint from 'typescript-eslint';
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import nodePlugin from 'eslint-plugin-n';
import securityPlugin from 'eslint-plugin-security';
import importPlugin from 'eslint-plugin-import-x';
import globals from 'globals';

export default tseslint.config(
  // only linting our own code, not what the build tools have generated.
  { ignores: ['**/dist/**', 'coverage/**', '.claude/**'] },

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

  // prettierConfig at the end ensures that ESLint won't conflict with prettier
  // over indentation, quotes, semicolons, and so on.
  prettierConfig,
);
