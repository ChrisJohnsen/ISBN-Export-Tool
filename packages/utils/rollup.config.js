// spellcheck: off

import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-ts';

const basePlugins = [typescript()];
const externalPlugins = [commonjs(), node_resolve(), ...basePlugins];

export default [
  {
    input: 'src/index.ts',
    output: [
      { file: 'dist/index.js' },
      { file: 'dist/index.cjs', format: 'cjs' },
    ],
    external: [/* 'papaparse', */ 'isbn3', 'typanion'],
    plugins: externalPlugins,
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
  },
];
