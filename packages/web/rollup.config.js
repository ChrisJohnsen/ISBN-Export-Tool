import typescript from 'rollup-plugin-ts';

export default async cliOptions => {
  const modifyPath = p => cliOptions.configPathPrefix?.concat('/', p) ?? p;
  return {
    input: [
      modifyPath('src/measure-image.ts'),
      modifyPath('src/safe-area-insets.ts'),
    ],
    output: { dir: modifyPath('dist') },
    external: [],
    plugins: [typescript({ tsconfig: modifyPath('tsconfig.json') })],
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
  };
};
