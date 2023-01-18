// spellcheck: off

import { defaults as jestDefaults } from 'jest-config';

/*
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

export default function customizeConfig(preset = {}) {
  return {
    ...preset,
    clearMocks: true,
    moduleFileExtensions: Array.from(new Set(
      ['ts', 'js', 'cjs', ...(preset.moduleFileExtensions ?? jestDefaults.moduleFileExtensions)])),
    extensionsToTreatAsEsm: ['.ts'],
    testMatch: [
      '**/tests/**/*.@(ts|js|cjs)'
    ],
    transform: {
      '\\.ts$': ['<rootDir>/../../configs/jest-esbuild.js', { /* options passed to esbuild */ }]
    }
  };
}
