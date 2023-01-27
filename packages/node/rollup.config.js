// spellcheck: off

import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';

const plugins = [node_resolve(), commonjs(), esbuild({ target: "es2022" })];

export default [
  {
    input: 'src/goodreads-tool.ts',
    output: [
      {
        file: 'dist/goodreads-tool-bundled.mjs',
        inlineDynamicImports: true,
        sourcemap: true,
      },
      {
        file: 'dist/goodreads-tool-bundled.cjs',
        format: 'cjs',
        inlineDynamicImports: true,
        sourcemap: true,
      },
    ],
    external: [],
    plugins,
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
    moduleContext(moduleId) {
      if (/\.zip[/\\]node_modules[/\\](lowdb|steno)[/\\]/.test(moduleId)) {
        // lowdb and steno include TS-generated private accessor helper functions that harmlessly use global this
        // silence THIS_IS_UNDEFINED by providing an alternate spelling of undefined for their use as this
        return '(void 0)';
      }
      return 'undefined';
    },
  },
];
