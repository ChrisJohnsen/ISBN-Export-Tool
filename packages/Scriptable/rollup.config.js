import { stat } from 'node:fs/promises';
const isDir = pn => stat(pn).then(s => s.isDirectory(), () => false);

import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
import virtual from '@rollup/plugin-virtual';
import consts from 'rollup-plugin-consts';
const outdent = deferPlugin('rollup-plugin-outdent', async (...args) => (await import('preoutdent')).default(...args));

export default async cliOptions => {
  const modifyPath = p => cliOptions.configPathPrefix?.concat('/', p) ?? p;
  const iCloud = cliOptions.configiCloud; // spell-checker:ignore configiCloud
  const release = await (async release => {
    if (typeof release == 'undefined') return false;
    if (release == true) {
      console.error('--configRelease must be given a path: output will be written to <path>/Scriptable/');
      return false;
    }
    const releaseStr = String(release);
    if (!releaseStr) {
      console.error('--configRelease must be given a non-empty path: output will be written to <path>/Scriptable/');
      return false;
    }
    if (!await isDir(releaseStr)) {
      console.error('--configRelease must be given a path to an existing directory: output will be written to <path>/Scriptable/');
      return false;
    }
    return releaseStr;
  })(cliOptions.configRelease);
  const production = !!release || !!cliOptions.configProduction;
  const useTerser = !!release || !!cliOptions.configTerser;

  if (production && cliOptions.watch)
    console.warn('Warning: in watch mode, git description and license information is only collected once per Rollup config load');

  const git = { description: '(did not run "git-describe")' };
  const config = {
    input: modifyPath('src/isbn-tool.ts'),
    output: [
      { file: modifyPath('dist/isbn-tool.js') },
      iCloud && { file: modifyPath('iCloud/ISBN Tool.js') },
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
      commonjs(), node_resolve(), esbuild({ target: 'es2022' }),
      outdent(),
    ],
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
  };

  config.plugins.push(deferPlugin('consts', async () =>
    consts({
      production,
      // Note: these effectively gets "cached" in watch mode since plugin is only constructed when config is (re)loaded
      git,
      dependencies:
        production ? await gatherLicenses(config.input) : [],
    }))());

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

async function gatherLicenses(input) {
  try {
    // this must be deferred until utils has been built!
    const { rollup } = await import('rollup');
    const license = (await import('rollup-plugin-license')).default;
    /** @type import('rollup-plugin-license').Dependency[] */
    let deps;
    const bundle = await rollup({
      input,
      plugins: [
        consts({ production: true, git: '<no description while gathering licenses>', dependencies: [] }),
        commonjs(), node_resolve(), esbuild({ target: 'es2022' }),
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
        })],
    });
    await bundle.generate({ dir: 'no actual output' });
    return deps.map(d => ({ name: d.name, version: d.version, license: d.license, licenseText: d.licenseText }));
  } catch (e) {
    console.error('unable to gather license information!');
    throw e;
  }
}

/**
 * Defer loading a Rollup plugin until the last second (`options` get).
 *
 * We need this here because the top-level Rollup config loads all the workspace
 * Rollup configs. But _this_ workspace Rollup config depends on one of the
 * other workspace modules (the plugin). So...
 *
 * Fake having created the plugin until the last minute (when Rollup asks for
 * `options` property), then run the given function to load the module and make
 * the plugin instance, then start proxy-ing to it. Rollup's flexibility with
 * Promise-like return values is really handy here! (our "deferred" plugin's
 * `options` is async whether the real one is or not)
 *
 * _This is probably wildly unreliable!_
 *
 * This worked okay in testing where the only property gets before `options`
 * were a few `then`s.
 *
 * @param {string} pluginName
 * @param {string} pluginModule
 *
 * @returns {import('rollup').PluginImpl} a plugin creation function that creates a "deferred" plugin object
 */
function deferPlugin(pluginName, deferredMake) {
  return (...args) => {
    const fake = { name: pluginName + '-deferred' };
    let real;
    return new Proxy(fake, {
      get(target, property, receiver) {
        if (real != null)
          return Reflect.get(real, property, receiver);
        else if (property == 'options')
          return async () => {
            try {
              real = await deferredMake(...args);
              return Reflect.get(real, property, receiver);
            } catch (e) {
              console.warn(`failed to load deferred ${pluginName} plugin`);
              return Reflect.get(target, property, receiver);
            }
          };
        else
          return Reflect.get(target, property, receiver);
      },
    });
  };
}
