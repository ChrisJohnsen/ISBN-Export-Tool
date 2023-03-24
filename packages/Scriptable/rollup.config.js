// spellcheck: off

import { promisify } from 'node:util';
import { exec as execCb } from 'node:child_process';
const exec = promisify(execCb);
import { stat } from 'node:fs/promises';
const isDir = pn => stat(pn).then(s => s.isDirectory(), () => false);

import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
import virtual from '@rollup/plugin-virtual';
import consts from 'rollup-plugin-consts';

export default async cliOptions => {
  const iCloud = cliOptions.configiCloud;
  const git = {
    description: await exec('git describe --long --dirty')
      .then(e => e.stdout.trim(), () => '(unable to run "git describe")'),
  };
  const release = await (async release => {
    if (typeof release == 'undefined') return false;
    if (release == true) {
      console.error('--configRelease must be given a path: output will the written to <path>/Scriptable/');
      return false;
    }
    const releaseStr = String(release);
    if (!releaseStr) {
      console.error('--configRelease must be given a non-empty path: output will the written to <path>/Scriptable/');
      return false;
    }
    if (!await isDir(releaseStr)) {
      console.error('--configRelease must be given a path to an existing directory: output will the written to <path>/Scriptable/');
      return false;
    }
    return releaseStr;
  })(cliOptions.configRelease);
  const production = !!release || !!cliOptions.configProduction;
  const config = [
    {
      input: 'src/isbn-tool.ts',
      output: [
        { file: 'dist/isbn-tool.js' },
        iCloud && { file: 'iCloud/ISBN Tool.js' },
        release && {
          file: release + '/Scriptable/ISBN Tool.js',
          banner: `/* ${production ? 'production' : 'development'} git: ${git.description} @preserve */`,
        },
      ],
      external: [],
      plugins: [
        // Papaparse leaves a remnant `import x from 'stream'` that Scriptable does not understand
        // we do not use what it eventually references, so just stub it out
        virtual({ stream: 'export default {}' }),
        consts({ production, git }),
        commonjs(), node_resolve(), esbuild({ target: "es2022" })
      ],
      watch: {
        clearScreen: false,
        buildDelay: 50, // helps prevent immediate rebuild
      },
    },
  ];
  const terser = await (async use => use ? (await import('@rollup/plugin-terser')).default : void 0)(release || cliOptions.configTerser);
  if (terser)
    config.forEach(({ output }) => output.forEach(output => {
      if (output)
        output.plugins = [terser()];
    }));
  return config;
};
