import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-ts';

import { fileURLToPath, URL } from "node:url";
const cwd = fileURLToPath(new URL('.', import.meta.url));

const plugins = [node_resolve(), commonjs(), typescript({ tsconfig: `${cwd}/tsconfig.json` })];

export default [
  {
    input: 'src/index.ts',
    output: { preserveModules: true, dir: 'dist' },
    external: ['papaparse', 'isbn3', 'typanion', 'p-throttle', 'p-limit'],
    plugins,
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
  },
];
