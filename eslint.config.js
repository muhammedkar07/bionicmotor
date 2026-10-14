const js = require('@eslint/js');

const NODE = {
  process: 'readonly',
  console: 'readonly',
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  global: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  AbortController: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  structuredClone: 'readonly'
};
const BROWSER = {
  window: 'readonly',
  document: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  FormData: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  requestAnimationFrame: 'readonly',
  console: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  Option: 'readonly',
  Image: 'readonly'
};

module.exports = [
  { ignores: ['node_modules/**', 'public/uploads/**', 'demo-data/**', 'logs/**', 'backups/**', 'tasarim/**', 'data/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: NODE },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-control-regex': 'off'
    }
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: BROWSER }
  }
];
