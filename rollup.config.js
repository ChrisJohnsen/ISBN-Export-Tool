import { loadConfigFile } from 'rollup/loadConfigFile';

export default async cliOptions => {
  return (await Promise.all([
    'utils',
    'preoutdent',
    'web',
    'Scriptable',
    'node',
  ].map(async packagesDir => {

    const emptyConfig = { watch: { clearScreen: false } };

    const dir = `packages/${packagesDir}`;
    const configFile = `${dir}/rollup.config.js`;
    const cliOpts = { ...cliOptions, configPathPrefix: dir };

    const config = await (async () => {
      try {
        const { options, warnings } = await loadConfigFile(configFile, cliOpts);
        warnings.flush();
        return options;
      } catch (e) {
        console.error('unable to load config', configFile, e.message ? e.message : e);
        return emptyConfig;
      }
    })();

    if (config === emptyConfig) return config;

    try {
      return modifyConfig(config, configFile);
    } catch (e) {
      console.error(e);
      return emptyConfig;
    }
  }))).flat();
};

function modifyConfig(rawConfig, configFile) {

  if (Array.isArray(rawConfig))
    return rawConfig.map(config => modifyConfig(config, configFile));

  const newConfig = { ...rawConfig };

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

}
