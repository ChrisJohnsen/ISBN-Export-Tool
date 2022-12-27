// spellcheck: off

import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';

const basePlugins = [node_resolve(), esbuild({ target: "es2022" })];
const externalPlugins = [commonjs(), ...basePlugins];

export default [
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
    plugins: externalPlugins,
  },
];
