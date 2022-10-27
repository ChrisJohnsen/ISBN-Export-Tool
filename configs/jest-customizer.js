// spellcheck: off

import { defaults as jestDefaults } from 'jest-config';

function supplementTSJOptions(transforms, customOptions) {
  return Object.entries(transforms).reduce(function processTransform(newTransforms, [pattern, transform]) {
    let transformer, options;
    if (Array.isArray(transform)) {
      [transformer, options = {}] = transform;
    } else {
      transformer = transform;
      options = {};
    }
    if (transformer !== 'ts-jest') {
      newTransforms[pattern] = transform;
    } else {
      const newOptions = Object.assign({}, options, customOptions);
      newTransforms[pattern] = [transformer, newOptions];
    }
    return newTransforms;
  }, {});
}

/*
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 * https://kulshekhar.github.io/ts-jest/docs/getting-started/options
 */

// preset: https://kulshekhar.github.io/ts-jest/docs/getting-started/presets#advanced
export default function customizeConfig(preset) {
  return {
    ...preset,
    clearMocks: true,
    moduleFileExtensions: Array.from(new Set(
      ['ts', 'js', 'cjs', ...(preset.moduleFileExtensions ?? jestDefaults.moduleFileExtensions)])),
    testMatch: [
      '**/tests/**/*.@(ts|js|cjs)'
    ],
    transform: supplementTSJOptions(preset.transform,
      { tsconfig: '<rootDir>/tests/tsconfig.json' }),
  };
}
