/**
 * ESLint configuration for the project.
 * Flat config, scoped to TS files, no Vite/webapp leftovers.
 */
// @ts-check
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import preferArrow from 'eslint-plugin-prefer-arrow-functions';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import * as tseslint from 'typescript-eslint';

const tsconfigRootDir = new URL('.', import.meta.url).pathname;

export default [
  // Ignore build/test artifacts
  {ignores: ['out', '.vscode-test', 'dist', 'src/webview', 'node_modules', 'esbuild.webview.mjs']},

  // Lint this config file under Node, allow URL global
  {
    files: ['eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {URL: 'readonly'},
    },
  },

  // Base JS rules for any .js/.mjs files (like this config)
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: {
      '@stylistic': stylistic,
      unicorn,
      sonarjs,
      import: importPlugin,
      'prefer-arrow-functions': preferArrow,
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir,
        sourceType: 'module',
        ecmaVersion: 2022,
      },
      globals: {
        // Node/VSCode runtime globals
        console: 'readonly',
        setTimeout: 'readonly',
        // Web APIs available in Node 18+ and VSCode runtime
        fetch: 'readonly',
        AbortController: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextDecoder: 'readonly',
        Response: 'readonly',
        ReadableStreamDefaultReader: 'readonly',
      },
    },
    rules: {
      // Disable base rules that conflict with @typescript-eslint equivalents
      'no-unused-vars': 'off',

      // Formatting/stylistic
      curly: 'warn',
      '@stylistic/semi': ['warn', 'always'],

      // TypeScript strictness (typed rules)
      '@typescript-eslint/strict-boolean-expressions': [
        'warn',
        {
          allowString: true,
          allowNumber: true,
          allowNullableObject: true,
          allowNullableBoolean: true,
          allowNullableString: true,
          allowNullableNumber: false,
        },
      ],
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-empty-function': 'error',
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_', varsIgnorePattern: '^_', args: 'all'}],
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', {allowNumber: true}],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',

      // Unicorn adjustments suitable for VSCode extension
      'unicorn/filename-case': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/prefer-query-selector': 'off',
      'unicorn/no-null': 'off',

      // Import rules baseline
      'import/no-cycle': ['error', {maxDepth: Infinity}],

      // General
      'no-dupe-else-if': 'error',
      'no-constant-condition': 'error',
      'no-console': ['error'],
      'no-debugger': 'error',

      // Prefer arrow functions
      'prefer-arrow-functions/prefer-arrow-functions': [
        'error',
        {
          classPropertiesAllowed: true,
          disallowPrototype: false,
          returnStyle: 'unchanged',
          singleReturnOnly: false,
        },
      ],

      // SonarJS subset
      'sonarjs/cognitive-complexity': 'warn',
      'sonarjs/no-duplicate-string': 'warn',
      'sonarjs/no-inconsistent-returns': 'warn',
      'prefer-template': 'warn',
    },
  },
];
