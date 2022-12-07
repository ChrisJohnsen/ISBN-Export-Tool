// spellcheck: off

import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-ts';

const basePlugins = [typescript()];
const externalPlugins = [commonjs(), node_resolve(), ...basePlugins];

export default [
  {
    input: 'src/functional.ts',
    output: [
      { file: 'dist/functional.js' },
      { file: 'dist/functional.cjs', format: 'cjs' },
    ],
    plugins: basePlugins,
  },
  {
    input: 'src/csv.ts',
    output: [
      { file: 'dist/csv.js' },
      { file: 'dist/csv.cjs', format: 'cjs' },
    ],
    plugins: externalPlugins,
  },
  {
    input: 'src/index.ts',
    output: [
      { file: 'dist/index.js' },
      { file: 'dist/index.cjs', format: 'cjs' },
    ],
    plugins: externalPlugins,
  },
];
