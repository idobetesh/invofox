// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');

module.exports = [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '!eslint.config.js', 'tools/admin/public/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // TypeScript specific rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // General rules
      'no-console': 'off', // We use console for logging
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],

      // Import rules
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message: 'Dynamic imports are not allowed. All imports must be at the top of the file.',
        },
      ],
    },
  },
  // Test files: ban loose multi-status assertions like expect([200, 500]).toContain(res.status)
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/tests/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message: 'Dynamic imports are not allowed. All imports must be at the top of the file.',
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='toContain'][callee.object.type='CallExpression'][callee.object.callee.name='expect'][callee.object.arguments.0.type='ArrayExpression'][arguments.0.type='MemberExpression'][arguments.0.property.name='status'][arguments.0.object.type='Identifier']",
          message:
            "Do not use expect([...]).toContain(response.status). Assert a single exact status code, e.g. expect(response.status).toBe(200).",
        },
      ],
    },
  },
];
