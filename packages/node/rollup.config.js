// spellcheck: off

import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';

export default [
  {
    input: 'src/goodreads-tool.ts',
    output: [
      { file: 'dist/goodreads-tool.mjs' },
      {
        file: 'dist/goodreads-tool.cjs',
        format: 'cjs',
      },
    ],
    external: ['clipanion'],
    plugins: [/* commonjs(), */ node_resolve(), esbuild({ target: "es2022" })],
  },
  {
    input: 'src/goodreads-tool.ts',
    output: [
      {
        file: 'dist/goodreads-tool-bundled.mjs',
        inlineDynamicImports: true,
      },
      {
        file: 'dist/goodreads-tool-bundled.cjs',
        format: 'cjs',
        inlineDynamicImports: true,
      },
    ],
    external: [],
    plugins: [commonjs(), node_resolve(), esbuild({ target: "es2022" })],
  },
];
