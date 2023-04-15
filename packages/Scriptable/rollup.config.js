import { stat } from 'node:fs/promises';
const isDir = pn => stat(pn).then(s => s.isDirectory(), () => false);

import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
import virtual from '@rollup/plugin-virtual';
import consts from 'rollup-plugin-consts';

export default async cliOptions => {
  const iCloud = cliOptions.configiCloud;
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
  const useTerser = !!release || !!cliOptions.configTerser;

  const git = { description: '(did not run "git-describe")' };
  /** @type { {name:string?, version:string?, license:string?, licenseText:string?}[] } */
  let dependencies = [];
  const config = {
    input: 'src/isbn-tool.ts',
    output: [
      { file: 'dist/isbn-tool.js' },
      iCloud && { file: 'iCloud/ISBN Tool.js' },
      release && {
        file: release + '/Scriptable/ISBN Tool.js',
        banner() {
          const mode = production ? 'production' : 'development';
          return `/*! ${mode} git: ${git.description} */`;
        },
      },
    ],
    external: [],
    plugins: [
      // Papaparse leaves a remnant `import x from 'stream'` that Scriptable does not understand
      // we do not use what it eventually references, so just stub it out
      virtual({ stream: 'export default {}' }),
      gitDescription(description => git.description = description), // updates value for consts and release banner
      consts({ production, git, dependencies }),
      commonjs(), node_resolve(), esbuild({ target: "es2022" })
    ],
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
  };

  if (production) {
    const { rollup } = await import('rollup');
    const license = (await import('rollup-plugin-license')).default;
    /** @type import('rollup-plugin-license').Dependency[] */
    let deps;
    const bundle = await rollup({
      ...config,
      plugins: config.plugins.concat([
        license({
          thirdParty: {
            includePrivate: true,
            output: d => deps = d,
            allow: {
              test: 'MIT',
              failOnUnlicensed: true,
              failOnViolation: true,
            }
          }
        })]),
    });
    await bundle.generate({ file: 'no actual output.js' });
    // update dependencies, which is referenced by object already closed over by consts
    deps.forEach(d => dependencies.push({ name: d.name, version: d.version, license: d.license, licenseText: d.licenseText }));
  }

  const terser = await (async use => use ? (await import('@rollup/plugin-terser')).default : void 0)(useTerser);
  if (terser)
    config.output.forEach(output => {
      if (output)
        output.plugins = [terser()];
    });
  return config;
};

import { promisify } from 'node:util';
import { exec as execCb } from 'node:child_process';
const exec = promisify(execCb);
/**
 * A tiny Rollup plugin to capture the output of `git describe --long --dirty` at `buildStart` time.
 * The description string is reported to `fn`.
 * @param {(description:string) => void} fn
 * @returns {import('rollup').Plugin}
 */
function gitDescription(fn) {
  return {
    async buildStart() {
      fn(await exec('git describe --long --dirty')
        .then(e => e.stdout.trim(), () => '(unable to run "git describe")'));
    }
  };
}
