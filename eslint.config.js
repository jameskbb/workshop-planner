import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', '.planning'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': 'off',
    },
  },
  {
    // The geometry engine and domain model must stay pure: no rendering imports.
    files: ['src/geometry/**/*.ts', 'src/domain/**/*.ts', 'src/analysis/**/*.ts'],
    // Tests may use library/demo fixtures.
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'react-konva', 'konva', 'konva/*', 'three', '@react-three/*'], message: 'geometry/domain/analysis must stay free of rendering libraries.' },
            { group: ['@/stores/*', '@/components/*', '@/features/*', '@/app/*'], message: 'geometry/domain/analysis must not depend on UI layers.' },
          ],
        },
      ],
    },
  },
);
