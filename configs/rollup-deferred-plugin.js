/**
 * @callback MaybeAsyncPluginMaker
 * @param {...unknown} args
 * @returns {( import('rollup').PluginImpl | Promise<import('rollup').PluginImpl> )}
 */

/**
 * Defer loading a Rollup plugin until the last second (`options` get).
 *
 * We need this here because the top-level Rollup config loads all the workspace
 * Rollup configs. But _this_ workspace Rollup config depends on one of the
 * other workspace modules (the plugin). So...
 *
 * Fake having created the plugin until the last minute (when Rollup asks for
 * `options` property), then run the given function to load the module and make
 * the plugin instance, then start proxy-ing to it. Rollup's flexibility with
 * Promise-like return values is really handy here! (our "deferred" plugin's
 * `options` is async whether the real one is or not)
 *
 * _This is probably wildly unreliable!_
 *
 * This worked okay in testing where the only property gets before `options`
 * were a few `then`s.
 *
 * @param {string} pluginName
 * @param {MaybeAsyncPluginMaker} deferredMake
 * @param {boolean} [freshInstanceAfterClose=false] reuse `deferredMake` to build a fresh plugin instance if plugin is used again after `closeBundle`
 *
 * @returns {import('rollup').PluginImpl} a plugin creation function that creates a "deferred" plugin object
 */
export default function deferPlugin(pluginName, deferredMake, freshInstanceAfterClose = false) {
  return (...args) => {
    const fake = { name: pluginName + '-deferred' };
    let real;
    return new Proxy(fake, {
      get(target, property, receiver) {
        // console.log(pluginName, property);
        if (real != null)
          try {
            return Reflect.get(real, property, receiver);
          } finally {
            if (property == 'closeBundle' && freshInstanceAfterClose)
              real = void 0;
          }
        else if (property == 'options')
          return async () => {
            try {
              real = await deferredMake(...args);
              return Reflect.get(real, property, receiver);
            } catch (e) {
              console.warn(`failed to load deferred ${pluginName} plugin`);
              return Reflect.get(target, property, receiver);
            }
          };
        else
          return Reflect.get(target, property, receiver);
      },
    });
  };
}
