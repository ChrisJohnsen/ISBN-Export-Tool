import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-ts';

export default async cliOptions => {
  const modifyPath = p => cliOptions.configPathPrefix?.concat('/', p) ?? p;
  return {
    input: modifyPath('src/index.ts'),
    output: { preserveModules: true, dir: modifyPath('dist') },
    external: ['papaparse', 'isbn3', 'typanion', 'p-throttle', 'p-limit'],
    plugins: [node_resolve(), commonjs(), typescript({ tsconfig: modifyPath('tsconfig.json') })],
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
  };
};
