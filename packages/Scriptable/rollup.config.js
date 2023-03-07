// spellcheck: off

import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
import virtual from '@rollup/plugin-virtual';
import consts from 'rollup-plugin-consts';

export default async cliOptions => {
  const iCloud = cliOptions.configiCloud;
  const production = !!cliOptions.configProduction;
  const config = [
    {
      input: 'src/isbn-tool.ts',
      output: [
        { file: 'dist/isbn-tool.js' },
        iCloud && { file: 'iCloud/ISBN Tool.js' },
      ],
      external: [],
      plugins: [
        // Papaparse leaves a remnant `import x from 'stream'` that Scriptable does not understand
        // we do not use what it eventually references, so just stub it out
        virtual({ stream: 'export default {}' }),
        consts({ production }),
        commonjs(), node_resolve(), esbuild({ target: "es2022" })
      ],
      watch: {
        clearScreen: false,
        buildDelay: 50, // helps prevent immediate rebuild
      },
    },
  ];
  const terser = await (async use => use ? (await import('@rollup/plugin-terser')).default : void 0)(cliOptions.configTerser);
  if (terser)
    config.forEach(({ output }) => output.forEach(output => output.plugins = [terser()]));
  return config;
};
