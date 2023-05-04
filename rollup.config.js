import { loadConfigFile } from 'rollup/loadConfigFile';

export default async cliOptions => {
  return (await Promise.all([
    'utils',
    'preoutdent',
    'Scriptable',
    'node',
  ].map(async packagesDir => {

    const emptyConfig = { watch: { clearScreen: false } };

    const dir = `packages/${packagesDir}`;

    const configFile = `./${dir}/rollup.config.js`;
    const config = await (async () => {
      try {
        const { options, warnings } = await loadConfigFile(configFile, cliOptions);
        warnings.flush();
        return options;
      } catch (e) {
        console.error('unable to load config', configFile, e.message ? e.message : e);
        return emptyConfig;
      }
    })();

    if (config === emptyConfig) return config;

    try {
      return modifyConfig(dir, config, configFile);
    } catch (e) {
      console.error(e);
      return emptyConfig;
    }
  }))).flat();
};

function modifyConfig(pathTo, rawConfig, configFile) {

  if (Array.isArray(rawConfig))
    return rawConfig.map(config => modifyConfig(pathTo, config, configFile));

  const newConfig = { ...rawConfig };

  if (typeof newConfig.input != 'string')
    throw 'expected .input to be string';

  newConfig.input = modifyPath(newConfig.input);

  if (!Array.isArray(newConfig.output))
    throw 'expected .output to be array';

  newConfig.output.forEach((output, n) => {
    if (typeof output != 'object' && output)
      throw `expected .output[${n}] to be object`;

    if ('file' in output && output.file != null) {
      if (typeof output.file != 'string')
        throw `expected .output[${n}].file to be string`;
      output.file = modifyPath(output.file);
    }

    if ('dir' in output && output.dir != null) {
      if (typeof output.dir != 'string')
        throw `expected .output[${n}].dir to be string`;
      output.dir = modifyPath(output.dir);
    }
  });

  if (!Array.isArray(newConfig.plugins)) {
    console.warn('.plugins is not an array; unable to add watch-included-config plugin');
  } else {
    newConfig.plugins.push({
      name: 'watch-included-config',
      buildStart(options) {
        this.addWatchFile(configFile);
      },
    });
  }

  return newConfig;

  function modifyPath(path) {
    return pathTo + '/' + path;
  }
}
