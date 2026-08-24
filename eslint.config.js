// Flat config (eslint 9). Replaces the old .eslintrc.json, which eslint 9 no longer reads and
// whose plugins were never installed — so `npx eslint src` had been a no-op error.
import tseslint from 'typescript-eslint';
// Config-only: switches off eslint's stylistic rules that would fight Prettier. The
// `prettier/prettier` *rule* is deliberately not enabled — this codebase predates Prettier's
// defaults, so turning it on buries every real finding under ~28k formatting warnings.
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Build output, deps and coverage/report artefacts are not ours to lint.
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'test-report/**',
      'logs/**',
      'tmp/**',
      'docs/api/openapi/dist/**',
    ],
  },
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      // CLAUDE.md treats `any` as banned in source. Tests keep their own relaxation below.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Test doubles model prisma's generated argument shapes, which is where `any` earns its keep,
    // and a jest.mock factory is hoisted above imports so it can only pull deps in with require().
    files: ['**/*.test.ts', 'tests/**/*.ts', 'src/test-utils/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
