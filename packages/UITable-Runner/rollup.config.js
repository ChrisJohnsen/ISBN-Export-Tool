import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
import typescript from 'rollup-plugin-ts';
import virtual from '@rollup/plugin-virtual';
import license from 'rollup-plugin-license';
import { resolve } from 'node:path';

export default async cliOptions => {
  const modifyPath = p => cliOptions.configPathPrefix?.concat('/', p) ?? p;
  const cwd = resolve(modifyPath(''));

  /** @type Set<string> */
  const extraWatchFiles = new Set;
  /** @type import('rollup').PluginImpl */
  const extraWatchFilesPlugin = {
    buildStart() {
      extraWatchFiles.forEach(file => this.addWatchFile(file));
    }
  };

  const virtualForMeasureImageCode = deferPlugin('virtual', async () => {
    const { code, files } = await prebuild(modifyPath('src/web/measure-image.ts'));
    files.forEach(f => extraWatchFiles.add(f));
    return virtual({
      'measure-image code': 'export default ' + JSON.stringify(code),
    });
  }, true);

  const virtualForSafeAreaInsetsCode = deferPlugin('virtual', async () => {
    const { code, files } = await prebuild(modifyPath('src/web/safe-area-insets.ts'));
    files.forEach(f => extraWatchFiles.add(f));
    return virtual({
      'safe-area-insets code': 'export default ' + JSON.stringify(code),
    });
  }, true);

  const input = modifyPath('src/index.ts');

  const pkgConfig = {
    input: [input, ...[
      'measure',
      'polled-notifications',
      'line-breaks',
      'text-height',
    ].map(m => modifyPath(`src/${m}.ts`))],
    output: { dir: modifyPath('dist') },
    external: ['typanion'],
    plugins: [
      virtualForMeasureImageCode(),
      virtualForSafeAreaInsetsCode(),
      extraWatchFilesPlugin,
      commonjs(), node_resolve(), typescript({ tsconfig: modifyPath('tsconfig.json') }),
    ],
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
  };

  const bundleConfig = {
    input,
    output: { file: modifyPath('dist/bundled/auto-width-ui-runner.js'), format: 'cjs' },
    plugins: [
      license({
        cwd,
        banner: `Scriptable-ready bundle of <%= pkg.name %>
Version: <%= pkg.version %>

Bundled Dependencies:<% dependencies.forEach(dep => { %>
<%= dep.name %> <%= dep.version %> <%= dep.license && dep.license != '' ? '-- ' + dep.license : '' %><%
}) %>`,
        thirdParty: {
          includePrivate: true,
          allow: {
            test: 'MIT',
            failOnUnlicensed: true,
            failOnViolation: true,
          }
        }
      }),
      virtualForMeasureImageCode(),
      virtualForSafeAreaInsetsCode(),
      extraWatchFilesPlugin,
      commonjs(), node_resolve(), esbuild({ target: 'es2022' }),
    ],
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
  };

  const configs = [
    pkgConfig,
    bundleConfig,
  ];

  return configs;
};

async function prebuild(input) {
  try {
    const { rollup } = await import('rollup');
    const bundle = await rollup({
      input,
      plugins: [node_resolve(), esbuild({ target: 'es2022' })],
      // XXX if prebuilt code uses any dependencies, the license processing will miss them!
    });
    const { output: [{ code }] } = await bundle.generate({ file: 'no actual output.js' });
    await bundle.close();
    return { code, files: bundle.watchFiles };
  } catch (e) {
    console.log('unable to prebuild ' + input);
    console.error(e);
    throw e;
  }
}

/**
 * @callback MaybeAsyncPluginMaker
 * @param {...unknown} args
 * @returns {( import('rollup').PluginImpl | Promise<import('rollup').PluginImpl> )}
 */

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
 * @param {MaybeAsyncPluginMaker} deferredMake
 * @param {boolean} [freshInstanceAfterClose=false] reuse `deferredMake` to build a fresh plugin instance if plugin is used again after `closeBundle`
 *
 * @returns {import('rollup').PluginImpl} a plugin creation function that creates a "deferred" plugin object
 */
function deferPlugin(pluginName, deferredMake, freshInstanceAfterClose = false) {
  return (...args) => {
    const fake = { name: pluginName + '-deferred' };
    let real;
    return new Proxy(fake, {
      get(target, property, receiver) {
        // console.log(pluginName, property);
        if (real != null)
          try {
            return Reflect.get(real, property, receiver);
          } finally {
            if (property == 'closeBundle' && freshInstanceAfterClose)
              real = void 0;
          }
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
