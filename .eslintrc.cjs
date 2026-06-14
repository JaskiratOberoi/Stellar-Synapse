module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  extends: ['eslint:recommended'],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  ignorePatterns: ['out', 'dist', 'node_modules', '*.cjs', '*.js'],
  rules: {
    'no-unused-vars': 'off',
    'no-undef': 'off'
  }
}
