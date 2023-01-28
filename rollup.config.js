const configs = (await Promise.all([
  'papaparse',
  'utils',
  'node',
].map(async packagesDir => {

  const dir = `packages/${packagesDir}`;

  const configFile = `./${dir}/rollup.config.js`;
  const config = (await import(configFile)).default;

  return modifyConfig(dir, config, configFile);
}))).flat();

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

    if (typeof output.file != 'string')
      throw `expected .output[${n}].file to be string`;

    output.file = modifyPath(output.file);
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

export default configs;
