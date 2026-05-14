import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import n from 'eslint-plugin-n';

const browserFileGlobs = ['src/**/*.{js,jsx}'];
const nodeFileGlobs = [
  'server.js',
  'db-config.js',
  'lib/**/*.js',
  'middleware/**/*.js',
  'models/**/*.js',
  'migrations/**/*.js',
  'seeders/**/*.js',
  'routes/**/*.js',
  'services/**/*.js',
  'validation/**/*.js',
  'badges/**/*.js',
  'config/**/*.js',
  'tests/**/*.js',
  'tailwind.config.js',
  'postcss.config.js',
];
const rootEsmFileGlobs = ['eslint.config.js', 'vite.config.js', 'playwright.config.js'];

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      '.husky/**',
      'public/**',
      'coverage/**',
    ],
  },

  js.configs.recommended,

  // Frontend (browser) files
  {
    files: browserFileGlobs,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    settings: { react: { version: '18.3' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_|^error$',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // These rules target React 19 idioms; ScoreCast is on React 18.3 where these
      // patterns are fine. Re-enable as part of any React 19 upgrade.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
      // jsx-a11y rules that are too strict for the current handler patterns; revisit
      // when components get a proper a11y pass.
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
      'jsx-a11y/no-autofocus': 'off',
    },
  },

  // Backend (Node, CommonJS) files
  {
    files: nodeFileGlobs,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    plugins: { n },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_|^error$',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'n/no-process-exit': 'off',
      // Tier 13.9 — backend code must route through pino (lib/logger.js).
      // lib/instrument.js is the documented exception (Sentry init runs
      // before logger is loadable). Re-enable in that file via override
      // below; nothing else should use console.* on the server side.
      'no-console': 'error',
    },
  },

  // Tier 13.9 — lib/instrument.js fires before lib/logger.js is wired, so
  // it falls back to console.warn for "Sentry unavailable" messaging. Carve
  // it out individually rather than weakening the rule everywhere.
  {
    files: ['lib/instrument.js'],
    rules: { 'no-console': 'off' },
  },

  // Tier 13.9 — block deep relative imports anywhere. The new layered
  // structure (lib/ + middleware/ + routes/ + services/) means anything
  // crossing three directory boundaries is almost certainly a smell.
  {
    files: ['**/*.{js,jsx}'],
    ignores: ['node_modules/**', 'dist/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['../../../*', '../../../../*'] }],
    },
  },

  // Root ESM config files (this file, vite.config.js)
  {
    files: rootEsmFileGlobs,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
