// spellcheck: off

/*
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  displayName: '!!! TOP ???',
  projects: ['<rootDir>/packages/*'],
  testMatch: ['NO TOP-LEVEL TESTS'],
  watchPlugins: [['jest-watch-suspend', { 'suspend-on-start': true }]],
};

export default config;
