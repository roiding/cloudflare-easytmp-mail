import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.wrangler/**', 'coverage/**', 'docs/**'],
  },
  {
    files: ['scripts/**/*.{js,ts}', 'apps/api/build.js', 'eslint.config.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        Headers: 'readonly',
        URLSearchParams: 'readonly',
        URL: 'readonly',
        globalThis: 'readonly',
        RequestInit: 'readonly',
        Response: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
