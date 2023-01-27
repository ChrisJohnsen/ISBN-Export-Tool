const configs = (await Promise.all([
  'papaparse',
  'utils',
  'node',
].map(async packagesDir => {

  const dir = `packages/${packagesDir}`;

  const config = (await import(`./${dir}/rollup.config.js`)).default;

  return modifyConfig(dir, config);

}))).flat();

function modifyConfig(pathTo, rawConfig) {

  if (Array.isArray(rawConfig))
    return rawConfig.map(config => modifyConfig(pathTo, config));

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

  return newConfig;

  function modifyPath(path) {
    return pathTo + '/' + path;
  }
}

export default configs;
