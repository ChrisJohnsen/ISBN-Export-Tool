import { describe, test, expect } from '@jest/globals';
import { tl, ttl, nq, nx } from './template-helper.js';
import { outdent } from 'outdent';

void outdent; // used in eval

describe('tl/ttl and nx/nq helpers', () => {
  test('tl builds template literals and preserves raw', () => {
    expect(tl``).toBe('``');
    expect(tl`Alpha`).toBe('`Alpha`');
    expect(tl`Al\pha`).toBe('`Al\\pha`');
    expect(eval(tl`Al\pha`)).toBe('Alpha');

    const t = tl`   \

      Al\pha\r\
        Beta\n\
      Gamma\r\n\
    `;

    expect(t).toBe('`   \\\n\n      Al\\pha\\r\\\n        Beta\\n\\\n      Gamma\\r\\n\\\n    `');
    expect(eval(t)).toBe('   \n      Alpha\r        Beta\n      Gamma\r\n    ');
  });

  test('ttl builds tagged template literals and preserves raw', () => {
    function cooked(strings: TemplateStringsArray, ...values: unknown[]): string {
      return String.raw({ raw: strings }, ...values);
    }

    expect(cooked`\p`).toBe('p');

    expect(ttl`cooked``Alpha`).toBe('cooked`Alpha`');
    expect(ttl`cooked``Al\pha`).toBe('cooked`Al\\pha`');

    const t = ttl`cooked``   \

      Al\pha\r\
        Beta\n\
      Gamma\r\n\
    `;

    expect(t).toBe('cooked`   \\\n\n      Al\\pha\\r\\\n        Beta\\n\\\n      Gamma\\r\\n\\\n    `');
    expect(eval(t)).toBe('   \n      Alpha\r        Beta\n      Gamma\r\n    ');
  });

  test('nq builds "bare"-flagged non-quoted template literal expression strings', () => {
    expect(nq('Alpha')).toStrictEqual({ bare: '${Alpha}' });
    expect(nq(`Alpha`)).toStrictEqual({ bare: '${Alpha}' });
    expect(nq`Alpha`).toStrictEqual({ bare: '${Alpha}' });
    expect(nq`Alpha'`).toStrictEqual({ bare: "${Alpha'}" }); // beware: no safety checks for quoting
    expect(nq`Al\pha`).toStrictEqual({ bare: "${Al\\pha}" }); // raw
    expect(nq`Al\pha${'Beta'}`).toStrictEqual({ bare: "${Al\\phaBeta}" }); // exprs
  });


  test('nx builds "bare"-flagged strings', () => {
    expect(nx(`Alpha`)).toStrictEqual({ bare: 'Alpha' });
    expect(nx('Alpha')).toStrictEqual({ bare: 'Alpha' });
    expect(nx`Alpha`).toStrictEqual({ bare: 'Alpha' });
    expect(nx`Alpha'`).toStrictEqual({ bare: "Alpha'" }); // beware: no safety checks for quoting
    expect(nx`Al\pha`).toStrictEqual({ bare: "Al\\pha" }); // raw
    expect(nx`Al\pha${'Beta'}`).toStrictEqual({ bare: "Al\\phaBeta" }); // exprs
  });

  test('ttl and x try to minimize the pain of constructing quoted tagged template literals with interpolated expressions', () => {
    const t = `(() => ${ttl`outdent({})``   \

      ${nq`outdent`}
      ${nx`Alpha`}
        ${'Beta'}
      Gamma
          Delta
    `})()`;

    expect(t).toBe("(() => outdent({})`   \\\n\n      ${outdent}\n      Alpha\n        ${'Beta'}\n      Gamma\n          Delta\n    `)()");
    expect(eval(t)).toBe('Alpha\n  Beta\nGamma\n    Delta');
  });

  test('build nested tagging (like ttl uses)', () => {
    const x = '(() => ttl`tag``body`)()';
    const t = `(() => ttl\`tag\`${tl`body`})()`;
    const u = `(() => ttl${tl`tag`}${tl`body`})()`;
    const v = `(() => ${tl('ttl`tag`')`body`})()`;
    const w = `(() => ${ttl`ttl``tag`}${tl`body`})()`;

    expect(t).toBe(x);
    expect(u).toBe(x);
    expect(v).toBe(x);
    expect(w).toBe(x);
    expect(eval(x)).toBe('tag`body`');
  });
});
