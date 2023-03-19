// https://github.com/aelbore/esbuild-jest/issues/69#issuecomment-1210353145

import { transformSync } from 'esbuild';

const defaultOptions = {
  format: 'esm',
  sourcemap: 'external',
  target: `node${process.versions.node}`,
  loader: 'ts',
};

export default {
  createTransformer(userOptions) {
    debug('createTransformer');
    return {
      canInstrument: false,
      process(sourceText, sourcePath) {
        debug('\n\nprocess1\n');
        const options = {
          ...defaultOptions,
          ...userOptions,
          sourcefile: sourcePath,
        };

        // the current TS configuration requires .ts files to be imported with paths that end in .js and complains if path ends with .ts
        // esbuild doesn't follow and says "can't find whatever.js", but works if it ends in .ts (the actual path)
        // so, change imports of relative-pathed modules that end in TS-required-.js to actual-path-.ts to let esbuild work
        // using a regexp is obviously not a great way to do this...
        const importRe = /\b(import\b(?:.*?)?)(['"])(.*?)(?=\2)/mgs;
        const relJsRe = /^(\.\.?\/.*)\.js$/;
        debug([...sourceText.matchAll(importRe)].map(m => (delete m.input, m)));
        const relJsToTs = sourceText.replaceAll(importRe,
          (match, importStr, quoteChar, moduleStr) =>
            importStr + quoteChar + moduleStr.replace(relJsRe, '$1.ts'));

        const { code, map } = transformSync(relJsToTs, options);
        return { code, map };
      },
    };
  },
};

function debug(...args) {
  if (false)
    console.log(...args);
}
