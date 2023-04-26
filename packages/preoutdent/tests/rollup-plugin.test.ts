import { describe, jest, test, expect } from '@jest/globals';
import outdentPlugin, { type Options } from '../src/rollup-plugin.js';
import { parse, type Options as AcornOptions } from 'acorn';
import { type TransformPluginContext } from 'rollup';
import { ttl, tl, nq } from './template-helper.js';

const rollupContext = Object.freeze({
  parse(code: string, options: AcornOptions) {
    return parse(code, options);
  },
}) as unknown as TransformPluginContext;

function transform(code: string, { context = rollupContext, options = {}, id = 'outdent-plugin-test.js' }: { context?: TransformPluginContext, options?: Options, id?: string } = {}) {
  const plugin = outdentPlugin(options);
  const fn = typeof plugin.transform == 'object'
    ? plugin.transform.handler
    : plugin.transform;
  return fn?.call(context, code, id);
}

describe('outdent Rollup plugin', () => {
  test('transform empty', () => {
    expect(transform('')).toBeNull();
  });

  test('transform un-imported outdent', () => {
    expect(transform('outdent``')).toBeNull();
  });

  test('transform empty outdent', () => {
    expect(transform("import outdent from 'outdent';outdent``"))
      .toMatchObject({ code: "import outdent from 'outdent';``", map: { mappings: expect.any(String) } });
  });

  test('transform id filter', () => {
    const options = {
      include: /yes/,
      exclude: /no/,
    };
    const o = "import outdent from 'outdent';outdent``";
    const p = "import outdent from 'outdent';``";

    expect(transform(o, { options, id: 'yes.js' }))
      .toMatchObject({ code: p, map: { mappings: expect.any(String) } });
    expect(transform(o, { options, id: 'no.js' })).toBeNull();
    expect(transform(o, { options, id: 'yes-no.js' })).toBeNull();
  });

  test.each([
    ['string', 'different'],
    ['RegExp', /ere/],
    ['function', (s: string) => s.endsWith('rent')],
  ])('transform import source filter: %s', (...[, t]) => {
    const options = {
      isOutdent: t
    };
    const o = "import outdent from 'outdent';outdent``";
    const d = "import outdent from 'different';outdent``";
    const p = "import outdent from 'different';``";

    expect(transform(o, { options })).toBeNull();
    expect(transform(d, { options }))
      .toMatchObject({ code: p, map: { mappings: expect.any(String) } });
  });

  test('transform one outdent', () => {
    const o = `
      import outdent from 'outdent';
      ${ttl`outdent``
        Alpha
          Beta
        Gamma
      `};
    `;
    const p = `
      import outdent from 'outdent';
      ${tl`Alpha
  Beta
Gamma`};
    `;

    expect(transform(o))
      .toMatchObject({ code: p, map: { mappings: expect.any(String) } });
  });

  test('transform two outdent expressions', () => {
    const o = `
      import outdent from 'outdent';
      ${ttl`outdent``
        Alpha ${'Beta'}
          Gamma
        Delta
      `};
      function foo() {
        return ${ttl`outdent``
          Epsilon
            Zeta
              ${'Eta'}
          The${'ta'}
        `};
      }
    `;
    const p = `
      import outdent from 'outdent';
      ${tl`Alpha ${'Beta'}
  Gamma
Delta`};
      function foo() {
        return ${tl`Epsilon
  Zeta
    ${'Eta'}
The${'ta'}`};
      }
    `;

    expect(transform(o))
      .toMatchObject({ code: p, map: { mappings: expect.any(String) } });
  });

  test('transform outdent expression with options and indent marker expression', () => {
    const o = `
      import outdent from 'outdent';
      const g_outdent = outdent({newline:'[NL]'});
      export default String.raw${tl`${nq`(()=>{
        const l_outdent = g_outdent({trimLeadingNewline:false});
        return ${ttl`l_outdent({trimTrailingNewline:false})``    \

        ${nq`outdent`}
          Alpha
            ${nq`''+"Beta"`}
          Gamma
              Delta
              `};
      })()`}`};
    `;
    const p = `
      import outdent from 'outdent';
      const g_outdent = outdent({newline:'[NL]'});
      export default String.raw${tl`${nq`(()=>{
        const l_outdent = g_outdent({trimLeadingNewline:false});
        return ${tl`[NL]  Alpha[NL]    ${nq`''+"Beta"`}[NL]  Gamma[NL]      Delta[NL]      `};
      })()`}`};
    `;

    expect(transform(o))
      .toMatchObject({ code: p, map: { mappings: expect.any(String) } });
  });

  test('parser throws', () => {
    const context = {
      parse: () => { throw 'throwing from parse' },
      warn: jest.fn<TransformPluginContext['warn']>(),
    } as unknown as TransformPluginContext;

    expect(transform('', { context })).toBeNull();
    expect(context.warn).toHaveBeenCalledTimes(1);
  });

  test('parser returns undefined', () => {
    const context = {
      parse: () => void 0,
      warn: jest.fn<TransformPluginContext['warn']>(),
    } as unknown as TransformPluginContext;

    expect(transform('', { context })).toBeNull();
  });
});
