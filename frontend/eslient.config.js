import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: { react },
    settings: { react: { version: 'detect' } },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // This config has no full eslint-plugin-react rule set, so teach the base
      // no-unused-vars rule about JSX usage (e.g. `<motion.div>`, `<Icon/>`),
      // otherwise JSX-only identifiers are wrongly reported as unused.
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      // Loading data and syncing prop+local state inside effects is used
      // intentionally and pervasively here (data fetches, editable buffers,
      // reset-on-dep-change). Keep this strict new rule advisory rather than
      // blocking; revisit individual effects opportunistically.
      'react-hooks/set-state-in-effect': 'warn',
      // Honour the codebase conventions: `_`-prefixed throwaways (args, caught
      // errors, destructured placeholders) and the `{ node, ...props }`
      // rest-exclusion pattern used for react-markdown component overrides.
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
  // Node-side scripts (Express static server, build config) run outside the browser.
  {
    files: ['server.js', '**/*.config.{js,cjs,mjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
])