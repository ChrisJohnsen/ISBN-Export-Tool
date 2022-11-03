// spellcheck: off

import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';

export default [
  {
    input: 'src/test.ts',
    output: [
      { file: 'dist/test.mjs' },
      {
        file: 'dist/test.cjs',
        format: 'cjs',
      },
    ],
    external: ['papaparse'],
    plugins: [/* commonjs(), */ node_resolve(), esbuild({ target: "es2022" })],
  },
  {
    input: 'src/test.ts',
    output: [
      { file: 'dist/test-bundled.mjs' },
      {
        file: 'dist/test-bundled.cjs',
        format: 'cjs',
      },
    ],
    external: [],
    plugins: [commonjs(), node_resolve(), esbuild({ target: "es2022" })],
  },
];
