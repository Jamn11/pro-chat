module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier'
  ],
  settings: {
    react: { version: 'detect' }
  },
  env: {
    es2022: true,
    node: true,
    browser: true
  },
  overrides: [
    {
      files: ['*.config.*', '*.cjs', '*.mjs'],
      env: { node: true }
    },
    {
      files: ['vite.config.ts', 'vitest.config.ts', 'vitest.workspace.ts'],
      rules: { 'import/no-unresolved': 'off' }
    }
  ],
  rules: {
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
  }
};
