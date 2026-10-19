// ESLint flat config for the Node side of the project (ESM backend, CommonJS
// Electron shell, tests, e2e). The React/TypeScript frontend is type-checked by
// `tsc --noEmit` during `npm run web:build` and is linted separately in web/.
//
// Why this exists: gui.js and browser.js run only as a server / under Playwright,
// so an undefined identifier or a shadowed import does not surface until the app
// is actually started. `no-undef` turns that class of mistake into a build error.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    // Build output and third-party trees are never linted.
    ignores: [
      'node_modules/**',
      'release/**',
      'src/public/**',
      'web/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Unused code is dead weight; the project has been cleaned of it already,
      // so keep it from creeping back.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Catch the mistakes that only blow up at runtime in a server context.
      'no-undef': 'error',
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-func-assign': 'error',
      'no-self-assign': 'error',
      'no-unsafe-finally': 'error',
      'no-import-assign': 'error',
      'no-setter-return': 'error',
      // `catch {}` is used deliberately for best-effort cleanup ("close the tab
      // if it is still open"). Flagging it would bury the real findings.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // NOTE: `require-atomic-updates` is deliberately NOT enabled. Every hit it
      // produced here was an intentional sequential/memoisation pattern (cover
      // caching on the article object, the connect mutex, login-check guards)
      // that is genuinely safe because publishing is serialised.
    },
  },
  {
    // These files pass closures to `page.evaluate(...)`, which execute inside
    // the browser, so browser globals are legitimately referenced from Node
    // files. Without this every `document`/`Image`/`ClipboardItem` inside an
    // evaluate body is a false `no-undef`.
    files: [
      'src/parser.js',
      'src/browser.js',
      'src/platforms/**/*.js',
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // brand/ holds standalone asset-generation scripts that run IN a browser
    // (rendered by a headless browser), so they are browser-only, not Node.
    files: ['brand/**/*.mjs', 'brand/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // Electron main/preload/tray/supervisor are CommonJS (.cjs) and reach for
    // require / module / __dirname.
    files: ['electron/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    // Tests use node:test / node:assert and fixtures under tmpdir.
    files: ['test/**/*.js', 'e2e/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // brand/ holds standalone asset-generation scripts run with plain node.
    files: ['brand/**/*.mjs', 'brand/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
