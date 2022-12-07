// spellcheck: off

import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-ts';

export default [
  {
    input: 'src/functional.ts',
    output: [
      { file: 'dist/functional.js' },
      { file: 'dist/functional.cjs', format: 'cjs' },
    ],
    plugins: [typescript()],
  },
  {
    input: 'src/csv.ts',
    output: [
      { file: 'dist/csv.js' },
      { file: 'dist/csv.cjs', format: 'cjs' },
    ],
    plugins: [commonjs(), node_resolve(), typescript()],
  },
  {
    input: 'src/index.ts',
    output: [
      { file: 'dist/index.js' },
      { file: 'dist/index.cjs', format: 'cjs' },
    ],
    plugins: [commonjs(), node_resolve(), typescript()],
  },
];
