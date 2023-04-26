import node_resolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
// XXX switch to rollup-plugin-ts to generate .d.ts

export default async () => {
  return {
    input: 'src/rollup-plugin.ts',
    output: [
      { file: 'dist/index.js' },
      { file: 'dist/index.cjs', format: 'cjs', },
    ],
    external: ['@rollup/pluginutils', 'magic-string', 'estree-walker'],
    plugins: [
      node_resolve(), esbuild({ target: "es2022" })
    ],
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
  };
};
