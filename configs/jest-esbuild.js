// https://github.com/aelbore/esbuild-jest/issues/69#issuecomment-1210353145

import { transformSync } from 'esbuild';

const defaultOptions = {
  format: 'cjs',
  sourcemap: 'external',
  target: `node${process.versions.node}`,
  loader: 'ts',
};

export default {
  createTransformer(userOptions) {
    return {
      canInstrument: false,
      process(sourceText, sourcePath) {
        const options = {
          ...defaultOptions,
          ...userOptions,
          sourcefile: sourcePath,
        };
        const { code, map } = transformSync(sourceText, options);
        return { code, map };
      },
    };
  },
};
