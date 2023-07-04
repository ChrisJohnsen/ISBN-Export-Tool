import { stat } from 'node:fs/promises';
const isDir = pn => stat(pn).then(s => s.isDirectory(), () => false);

import commonjs from '@rollup/plugin-commonjs';
import node_resolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
import virtual from '@rollup/plugin-virtual';
import consts from 'rollup-plugin-consts';
import deferPlugin from '../../configs/rollup-deferred-plugin.js';
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

  const toolInput = modifyPath('src/isbn-tool.ts');
  const toolConfig = {
    input: toolInput,
    output: [
      { file: modifyPath('dist/isbn-tool.js') },
      iCloud && { file: modifyPath('iCloud/ISBN Tool (dev).js'), banner: updateScriptableBanner(modifyPath) },
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
      deferPlugin('consts', async () =>
        consts({
          production,
          // Note: these effectively gets "cached" in watch mode since plugin is only constructed when config is (re)loaded
          git,
          dependencies:
            production ? await gatherLicenses(toolInput) : [],
        }))(),
      commonjs(), node_resolve(), esbuild({ target: 'es2022' }),
      outdent(),
    ],
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
  };

  const rowInput = modifyPath('src/check UITableRow.ts');
  const rowConfig = {
    input: rowInput,
    output: [
      { file: modifyPath('dist/check UITableRow.js') },
      iCloud && { file: modifyPath('iCloud/check UITableRow.js'), banner: updateScriptableBanner(modifyPath) },
    ],
    external: [],
    plugins: [
      deferPlugin('consts', async () =>
        consts({
          production,
          dependencies: production ? await gatherLicenses(rowInput) : [],
        }))(),
      node_resolve(), esbuild({ target: 'es2022' }),
    ],
    watch: {
      clearScreen: false,
      buildDelay: 50, // helps prevent immediate rebuild
    },
  };

  const configs = [
    toolConfig,
    rowConfig,
  ];

  const terser = await (async use => use ? (await import('@rollup/plugin-terser')).default : void 0)(useTerser);
  if (terser)
    toolConfig.output.forEach(output => {
      if (output)
        output.plugins = [terser()];
    });

  return configs;
};

import { open } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

/**
 * @param {(path:string) => string} modifyPath
 * @returns {import('rollup').AddonFunction}
 */
function updateScriptableBanner(modifyPath) {
  return async chunk => {
    const contents = await (async () => {
      try {
        const path = modifyPath(`iCloud/${chunk.fileName}`);
        const rr = (await (await open(path)).read({ buffer: Buffer.alloc(1024) }));
        return rr.buffer.toString('utf-8', 0, rr.bytesRead);
      } catch {
        return '';
      }
    })();
    const block = contents.match(/^(?:\/\/.*(?:\r?\n|\r))*/)?.[0] ?? '';
    const newBanner = (() => {
      if (block.length > 0) {
        const lines = block.split(/\r?\n|\r/);
        if (lines[0] != '// Variables used by Scriptable.')
          return; // no Scriptable header lines, use default
        if (lines[1] != '// These must be at the very top of the file. Do not edit.')
          return ''; // only first Scriptable header line?!; do not add a banner
        const color = lines[2].match(' icon-color: ([^;]+)(?:$|;)')?.[1];
        if (!color)
          return ''; // no color to update; do not add a banner
        const colors = ['red', 'green', 'blue', 'brown', 'gray'];
        const nextColor = colors[(colors.findIndex(c => c == color) + 1) % colors.length];
        lines[2] = lines[2].replace(` icon-color: ${color}`, ` icon-color: ${nextColor}`);
        // If Scriptable ever adds a fourth line, we will need to find a
        // way to recognize it before we copy it. If we copied some
        // non-Scriptable fourth comment line that was actually produced
        // by some other part of the bundling process we would end up
        // duplicating it.
        return lines.slice(0, 3).join('\n');
      }
    })();
    if (newBanner == null)
      return [
        '// Variables used by Scriptable.',
        '// These must be at the very top of the file. Do not edit.',
        '// icon-color: red; icon-glyph: magic;',
      ].join('\n');
    return newBanner;
  };
}

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
        virtual({
          // XXX if these used external libraries, we would miss that here...
          'measure-image code': 'export default ""',
          'safe-area-insets code': 'export default ""',
        }),
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
    await bundle.close();
    return deps.map(d => ({ name: d.name, version: d.version, license: d.license, licenseText: d.licenseText }));
  } catch (e) {
    console.error('unable to gather license information!');
    throw e;
  }
}
