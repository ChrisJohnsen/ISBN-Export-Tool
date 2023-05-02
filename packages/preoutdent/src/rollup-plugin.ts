import type { PluginImpl } from 'rollup';
import { createFilter, type FilterPattern } from '@rollup/pluginutils';
import { transformWithMapping } from './transform.js';

export interface Options {
  include?: FilterPattern,
  exclude?: FilterPattern,
  isOutdent?: string | RegExp | ((moduleSource: string) => boolean),
}

const plugin: PluginImpl<Options> = (options: Options = {}) => {
  const filter = createFilter(options.include, options.exclude);
  const isOutdent = (s: string) => {
    const test = options.isOutdent;
    if (!test)
      return s == 'outdent';
    else if (typeof test == 'string')
      return s == test;
    else if (test instanceof RegExp)
      return test.test(s);
    else
      return test(s);
  };
  return {
    name: 'rollup-plugin-outdent',
    version: '0.1', // XXX
    transform(code: string, id: string) {
      if (!filter(id)) return null;

      const parse = ((...args) => this.parse(...args)) as Parameters<typeof transformWithMapping>[0];

      try {

        return transformWithMapping(parse, code, isOutdent);

      } catch (e) {
        this.warn((() => {
          if (typeof e == 'string')
            return { message: e };
          else if (e && typeof e == 'object') {
            if ('message' in e && typeof e.message == 'string')
              return { message: e.message };
            else
              return { message: `outdent transform failed: ${JSON.stringify(e)}` };
          } else
            return { message: `outdent transform failed: ${e}` };
        })());
        return null;
      }
    },
  };
};

export default plugin;
