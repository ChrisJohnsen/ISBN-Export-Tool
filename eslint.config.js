import js from '@eslint/js';
import ts from 'typescript-eslint';
import scriptable from '@scriptable-ios/eslint-config';
import globals from 'globals';
import jest from 'eslint-plugin-jest';
import jestFormatting from 'eslint-plugin-jest-formatting';

export default [{
  ignores: [
    '**/__snapshots__/',
    '**/dist/',
    '**/iCloud/',
  ],
},
{
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
},
js.configs.recommended,
{
  files: ['**/*.cjs'],
  languageOptions: {
    sourceType: 'commonjs',
    globals: { require: 'readonly' },
  },
},
...ts.config(
  { files: ['**/*.@(ts|js)'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    rules: {
      semi: ['error', 'always', { omitLastInOneLineBlock: true }],
      'semi-style': ['error', 'last'],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  }),
{
  files: ['**/tests/**/*.@(ts|js|cjs)'],
  ...jest.configs['flat/recommended'],
  rules: {
    ...jest.configs['flat/recommended'].rules,
    ...jestFormatting.configs.strict.overrides[0].rules,
    'jest/prefer-called-with': 'error',
    'jest/prefer-spy-on': 'error',
  },
  plugins: {
    ...jest.configs['flat/recommended'].plugins,
    'jest-formatting': jestFormatting
  },
},
{
  files: [
    'packages/Scriptable/src/**/*',
    'packages/UITable-Runner/src/**/*',
  ],
  languageOptions: {
    globals: scriptable.globals,
  }
},
{
  files: [
    'configs/*.js',
    '**/*.config.@(js|cjs|mjs)', // mainly rollup config
    'packages/Scriptable/*.js',  // release script
    'packages/node/src/**/*'
  ],
  languageOptions: {
    globals: globals.node,
  }
},
];
