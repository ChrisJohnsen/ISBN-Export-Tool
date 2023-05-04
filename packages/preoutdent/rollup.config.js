import node_resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-ts';

export default async cliOptions => {
  const modifyPath = p => cliOptions.configPathPrefix?.concat('/', p) ?? p;
  return {
    input: modifyPath('src/rollup-plugin.ts'),
    output: [
      { file: modifyPath('dist/index.js') },
      { file: modifyPath('dist/index.cjs'), format: 'cjs', },
    ],
    external: ['@rollup/pluginutils', 'magic-string', 'estree-walker'],
    plugins: [
      node_resolve(), typescript({ tsconfig: modifyPath('tsconfig.json') }),
    ],
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
  };
};
