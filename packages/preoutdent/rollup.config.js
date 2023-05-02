import node_resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-ts';

import { fileURLToPath, URL } from "node:url";
const cwd = fileURLToPath(new URL('.', import.meta.url));

export default async () => {
  return {
    input: 'src/rollup-plugin.ts',
    output: [
      { file: 'dist/index.js' },
      { file: 'dist/index.cjs', format: 'cjs', },
    ],
    external: ['@rollup/pluginutils', 'magic-string', 'estree-walker'],
    plugins: [
      node_resolve(), typescript({ tsconfig: `${cwd}/tsconfig.json` }),
    ],
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
  };
};
