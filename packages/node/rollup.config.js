import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';

const plugins = [node_resolve(), commonjs(), esbuild({ target: "es2022" })];

export default async cliOptions => {
  const config = {
    input: 'src/isbn-tool.ts',
    output: [
      {
        file: 'dist/isbn-tool-bundled.mjs',
        inlineDynamicImports: true,
        sourcemap: true,
      },
      {
        file: 'dist/isbn-tool-bundled.cjs',
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
  };
  const terser = await (async use => use ? (await import('@rollup/plugin-terser')).default : void 0)(cliOptions.configTerser);
  if (terser)
    config.output.forEach(output => output.plugins = [terser()]);
  return config;
};
