// spellcheck: off

import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-ts';

import { fileURLToPath, URL } from "node:url";
const cwd = fileURLToPath(new URL('.', import.meta.url));

const plugins = [node_resolve(), commonjs(), typescript({ tsconfig: `${cwd}/tsconfig.json` })];

export default [
  {
    input: 'index.ts',
    output: [
      { file: 'dist/index.js' },
      { file: 'dist/index.cjs', format: 'cjs' },
    ],
    external: [],
    plugins,
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
  },
];
