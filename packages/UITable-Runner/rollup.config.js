import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
import typescript from 'rollup-plugin-ts';
import virtual from '@rollup/plugin-virtual';
import license from 'rollup-plugin-license';
import { resolve } from 'node:path';
import deferPlugin from '../../configs/rollup-deferred-plugin.js';

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
    const { code, files } = await prebuild(modifyPath('src/web/measure-image.ts'), cwd);
    files.forEach(f => extraWatchFiles.add(f));
    return virtual({
      'measure-image code': 'export default ' + JSON.stringify(code),
    });
  }, true);

  const virtualForSafeAreaInsetsCode = deferPlugin('virtual', async () => {
    const { code, files } = await prebuild(modifyPath('src/web/safe-area-insets.ts'), cwd);
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

async function prebuild(input, cwd) {
  try {
    const { rollup } = await import('rollup');
    const bundle = await rollup({
      input,
      plugins: [
        // prebuilt code must not use any dependencies: we could capture
        // dependency information and integrate it into the "bundled" file's
        // banner, but there is currently no good way to notify "package"
        // dependents of such "pre-bundled" dependencies
        license({
          cwd,
          // banner: '#deps == <%= dependencies.length %>',
          // banner: 'deps == <%= JSON.stringify(dependencies) %>',
          thirdParty: {
            includePrivate: true,
            allow: {
              test: () => false,
              failOnUnlicensed: true,
              failOnViolation: true,
            }
          }
        }),
        node_resolve(), esbuild({ target: 'es2022' })
      ],
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

