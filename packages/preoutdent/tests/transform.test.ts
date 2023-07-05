import { describe, test, expect } from '@jest/globals';
import { transform as outdentTransform } from '../src/transform.js';
import { parse } from 'acorn';
import { outdent as testOutdent } from 'outdent';
import { tl, ttl, nq, nx } from './template-helper.js';

function transform(code: string): string {
  const preamble = `import defaultOutdent,{default as namedDefaultOutdent,outdent as renamedOutdent,outdent}from'outdent';import*as outdentNS from'outdent';`;
  const result = outdentTransform(parse, preamble + code);
  if (result.startsWith(preamble))
    return result.slice(preamble.length);
  return result;
}

// fake imports for our eval checking
const defaultOutdent = testOutdent;
const outdentNS = { outdent: testOutdent, default: testOutdent };
const { default: namedDefaultOutdent, outdent: renamedOutdent } = outdentNS;
const outdent = testOutdent;
void defaultOutdent, namedDefaultOutdent, renamedOutdent, outdent, outdentNS; // used in eval checking

describe('transform: no expressions', () => {
  test('empty', () => {
    const o = 'outdent``';
    const p = '``';
    const xo = '';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('no lines', () => {
    const o = 'outdent`Alpha`';
    const p = '`Alpha`';
    const xo = 'Alpha';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('no leading/trailing line break, no indent', () => {
    const o = ttl`outdent``AlphaBeta
Gamma
Delta`;
    const p = tl`AlphaBeta
Gamma
Delta`;
    const xo = 'AlphaBeta\nGamma\nDelta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['no leading/trailing line break, indent taken from second',
      ttl`outdent``AlphaBeta
    Gamma
      Delta`
    ],
    ['no leading line break, trailing line break',
      ttl`outdent``AlphaBeta
    Gamma
      Delta
  `
    ],
  ])('%s', (...[, o]) => {
    const p = tl`AlphaBeta
Gamma
  Delta`;
    const xo = 'AlphaBeta\nGamma\n  Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['leading line break, no trailing line break',
      ttl`outdent``
        AlphaBeta
          Gamma
            Delta`],
    ['no indent',
      ttl`outdent``
AlphaBeta
  Gamma
    Delta
`],
    ['indent with spaces',
      ttl`outdent``
        AlphaBeta
          Gamma
            Delta
      `],
    ['first indent uses space and tab and escaped versions',
      ttl`outdent``
 	\ \	\t   AlphaBeta
          Gamma
            Delta
      `],
    ['first indent uses space and tab escaped versions (x and u)',
      ttl`outdent``
\x09\x20\u0009\u0020\u{9}\u{20}  AlphaBeta
          Gamma
            Delta
      `],
    ['non-first indents use non-space',
      ttl`outdent``
        AlphaBeta
12345678  Gamma
.,:;!?()    Delta
      `],
  ])('%s', (...[, o]) => {
    const p = tl`AlphaBeta
  Gamma
    Delta`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  function codepointUse(cp: number) {
    const hex = cp.toString(16).padStart(4, '0');
    const char = String.fromCodePoint(cp);
    const strings = ((): TemplateStringsArray => {
      const s = `${char}    \n${char}   Alpha\n      Beta\n${hex}Gamma\n    ${char}`;
      return Object.assign([s], { raw: [s] });
    })();
    const code = ttl`outdent``${nx(strings[0])}`;
    return { strings, code };
  }

  test.each([0x0009, 0x0020])('valid indentation: space or tab (%i)', cp => {
    const { strings, code } = codepointUse(cp);

    expect(testOutdent(strings)).toBe('Alpha\n  Beta\nGamma');
    expect(transform(code)).toBe(tl`Alpha
  Beta
Gamma`);
  });

  test.each([
    0x000b, 0x000c,
    0x00a0, 0x1680,
    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
    0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff
  ])('not valid indentation: other from whitespace RegExp character class (%i)', cp => {
    const { strings, code } = codepointUse(cp);

    expect(testOutdent(strings)).toBe(strings[0]);
    expect(transform(code)).toBe(tl`${nx(strings[0])}`);
  });

  test('lines shorter than indent', () => {
    const o = ttl`outdent``
      Alpha
12345
b       Beta
1234
g     Gamma

.


d         Delta
    `;
    const p = tl`Alpha

  Beta

Gamma




    Delta`;
    const xo = 'Alpha\n\n  Beta\n\nGamma\n\n\n\n\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('multiple leading line breaks: only one stripped, indentation from first non-blank line', () => {
    const o = ttl`outdent``

      Alpha
b       Beta
g     Gamma
d         Delta
    `;
    const p = tl`
Alpha
  Beta
Gamma
    Delta`;
    const xo = '\nAlpha\n  Beta\nGamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });
});

describe('transform: no expressions, escaped characters', () => {
  test('no leading line break, trailing (escaped, with trailing non/escaped spaces)', () => {
    const o = ttl`outdent``AlphaBeta
      Gamma
        Delta\n 	\ \	\t\x20\x09\u0020\u0009\u{20}\u{9}`;
    const p = tl`AlphaBeta
Gamma
  Delta`;
    const xo = 'AlphaBeta\nGamma\n  Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['leading line break (escaped, with leading non/escaped spaces), no trailing line break',
      ttl`outdent`` 	\ \	\t\x20\x09\u0020\u0009\u{20}\u{9}\x0a        AlphaBeta
          Gamma
            Delta`],
    ['leading and trailing line break (escaped)',
      ttl`outdent``\u000A        AlphaBeta
          Gamma
            Delta\u{a}`],
    ['leading and trailing line break with space and tab, non/escaped',
      ttl`outdent`` 	\ \	\t\x20\x09\u0020\u0009\u{20}\u{9}
        AlphaBeta
          Gamma
            Delta
            \ \	\t\x20\x09\u0020\u0009\u{20}\u{9}`],
    ['escapes in stripped indents',
      ttl`outdent``
        AlphaBeta
\0\u{1}\x02\u{003}\u0004\u{00005}\u{000006}\x07  Gamma
\0\b\f\t\v\'\"\\    Delta
\\\a\c\d\e\f\g\h 	\ \	\t`],
  ])('%s', (...[, o]) => {
    const p = tl`AlphaBeta
  Gamma
    Delta`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('leading and trailing line break with space and tab, escaped versions', () => {
    const o = ttl`outdent``\ \	\t\x20\x09\u0020\u0009\u{20}\u{9}\n\ \	\t\x20\x09\u0020AlphaBeta\x0A\x20\x09\u0020\u0009\u{20}\u{9}  Gamma\u000A123456    Delta\u{a}  	\ \	\t\x20\x09\u0020\u0009\u{20}\u{9}`;
    const p = tl`AlphaBeta\x0A  Gamma\u000A    Delta`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('line continuations', () => {
    const o = ttl`outdent``\
 	\
\ \	\
\t\

      Alpha\
Beta
\
\0\u{1}\x02\
\u{003}\u0004\u{00005}\
  Gamma
\
\b\f\t\
\v\'\"\
    Delta
\
\\\a\c\
\d\e\f\
 	\
\ \	\
\t\
`;
    const p = tl`Alpha\
Beta
  Gamma
    Delta`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('CRLF line breaks', () => {
    const o = ttl`outdent``   \r\n      AlphaBeta\r\n        Gamma\r\n          Delta\r\n    `;
    const p = tl`AlphaBeta\r\n  Gamma\r\n    Delta`;
    const xo = 'AlphaBeta\r\n  Gamma\r\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('CR line breaks', () => {
    const o = ttl`outdent``   \r      AlphaBeta\r        Gamma\r          Delta\r    `;
    const p = tl`AlphaBeta\r  Gamma\r    Delta`;
    const xo = 'AlphaBeta\r  Gamma\r    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('mixed line breaks', () => {
    const o = ttl`outdent``   \r      Alpha\r\n         Beta\n      Gamma\r        Delta\r\n    `;
    const p = tl`Alpha\r\n   Beta\nGamma\r  Delta`;
    const xo = 'Alpha\r\n   Beta\nGamma\r  Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('line continuation in the middle of CRLF', () => {
    const o = ttl`outdent``   \r\
\n      Alpha\r\
\n         Beta\r\
\
\n      Gamma\r\
\
\
\n        Delta\r\
\
\
\
\n    `;
    const p = tl`Alpha\r\
\n   Beta\r\
\
\nGamma\r\
\
\
\n  Delta`;
    const xo = 'Alpha\r\n   Beta\r\nGamma\r\n  Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });
});

describe('transform: expressions', () => {
  test('just one expression', () => {
    const o = ttl`outdent``${'Alpha'}`;
    const p = tl`${'Alpha'}`;
    const xo = 'Alpha';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('just two expressions', () => {
    const o = ttl`outdent``${'Alpha'}${'Beta'}`;
    const p = tl`${'Alpha'}${'Beta'}`;
    const xo = 'AlphaBeta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('two lines, two expressions, no leading or trailing line break, no indent', () => {
    const o = ttl`outdent``${'Alpha'}
${'Beta'}`;
    const p = tl`${'Alpha'}
${'Beta'}`;
    const xo = 'Alpha\nBeta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('two lines, two expressions, no leading or trailing line break', () => {
    const o = ttl`outdent``${'Alpha'}
      ${'Beta'}`;
    const p = tl`${'Alpha'}
      ${'Beta'}`;
    const xo = 'Alpha\n      Beta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('two lines, two expressions, leading spaces, no leading or trailing line break', () => {
    const o = ttl`outdent``   ${'Alpha'}
      ${'Beta'}`;
    const p = tl`   ${'Alpha'}
      ${'Beta'}`;
    const xo = '   Alpha\n      Beta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('two lines, two expressions, no leading line break', () => {
    const o = ttl`outdent``${'Alpha'}
      ${'Beta'}
    `;
    const p = tl`${'Alpha'}
      ${'Beta'}`;
    const xo = 'Alpha\n      Beta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['two lines, two expressions, no trailing line break',
      ttl`outdent``
        ${'Alpha'}
        ${'Beta'}`],
    ['two lines, two expressions',
      ttl`outdent``
        ${'Alpha'}
        ${'Beta'}
      `],
    ['two lines, two expressions, expression in non-first indentation',
      ttl`outdent``
        ${'Alpha'}
    ${'Beta'}
      `],
  ])('%s', (...[, o]) => {
    const p = tl`${'Alpha'}
${'Beta'}`;
    const xo = 'Alpha\nBeta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('two lines, two expressions, expression in first indentation', () => {
    const o = ttl`outdent``
  ${'Alpha'}
      ${'Beta'}
    `;
    const p = tl`${'Alpha'}
    ${'Beta'}`;
    const xo = 'Alpha\n    Beta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('two lines, three expressions, expression in trailing spaces (makes it three lines)', () => {
    const o = ttl`outdent``
      ${'Alpha'}
  ${'Beta'}
    ${'Gamma'}  `;
    const p = tl`${'Alpha'}
${'Beta'}
${'Gamma'}  `;
    const xo = 'Alpha\nBeta\nGamma  ';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('five lines, two expressions, non-expression lines before, between, and after', () => {
    const o = ttl`outdent``
      Alpha
b ${'Beta'}
g         Gamma
d       ${'Delta'}
e     Epsilon
---    `;
    const p = tl`Alpha
${'Beta'}
    Gamma
  ${'Delta'}
Epsilon`;
    const xo = 'Alpha\nBeta\n    Gamma\n  Delta\nEpsilon';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('five lines, five expressions, 0,2,0,3,0 expressions', () => {
    const o = ttl`outdent``
      Alpha
bg${'Beta'} ${'Gamma'}
 d        Delta
  eze   ${'Epsilon'}	${'Zeta'}+${'Eta'}
     tTheta
---    `;
    const p = tl`Alpha
${'Beta'} ${'Gamma'}
    Delta
  ${'Epsilon'}	${'Zeta'}+${'Eta'}
Theta`;
    const xo = 'Alpha\nBeta Gamma\n    Delta\n  Epsilon	Zeta+Eta\nTheta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('${outdent} before line break (erroneous usage)', () => {
    const o = ttl`outdent``   ${nq`outdent`}
      Alpha${'Beta'}
        ${'Gamma'}
 d      Delta
---    `;
    const p = tl`   ${nq`outdent`}
      Alpha${'Beta'}
        ${'Gamma'}
 d      Delta
---    `;
    const xo = '   ' + testOutdent.toString() + '\n      AlphaBeta\n        Gamma\n d      Delta\n---    ';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['${outdent} after leading line break (correct usage)',
      ttl`outdent``
       ${nq`outdent`}
        Alpha${'Beta'}
        ${'Gamma'}
 d        Delta
---      `],
    ['${outdent} after leading line break with leading spaces (acceptable usage)',
      ttl`outdent``   \

       ${nq`outdent`}
        Alpha${'Beta'}
        ${'Gamma'}
 d        Delta
---      `],
    ['${outdent} after multiple leading line breaks with leading spaces (acceptable usage)',
      ttl`outdent``   \

    \

       ${nq`outdent`}
        Alpha${'Beta'}
        ${'Gamma'}
 d        Delta
---      `],
  ])('%s', (...[, o]) => {
    const p = tl` Alpha${'Beta'}
 ${'Gamma'}
   Delta`;
    const xo = ' AlphaBeta\n Gamma\n   Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('${outdent} after leading line break with trailing spaces (erroneous usage)', () => {
    const o = ttl`outdent``
     ${nq`outdent`}   \

      Alpha${'Beta'}
      ${'Gamma'}
 d      Delta
---    `;
    const p = tl`${nq`outdent`}   \

 Alpha${'Beta'}
 ${'Gamma'}
   Delta`;
    const xo = testOutdent.toString() + '   \n AlphaBeta\n Gamma\n   Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('${outdent} not the first expression (erroneous usage)', () => {
    const o = ttl`outdent``
      ${'Alpha'}
     ${nq`outdent`}   \

      Beta
      ${'Gamma'}
 d      Delta
---    `;
    const p = tl`${'Alpha'}
${nq`outdent`}   \

Beta
${'Gamma'}
  Delta`;
    const xo = 'Alpha\n' + testOutdent.toString() + '   \nBeta\nGamma\n  Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('${outdent} with expression immediately after (acceptable usage?)', () => {
    const o = ttl`outdent``   \

     ${nq`outdent`}\
\
${''}
      Alpha${'Beta'}
        ${'Gamma'}
 d        Delta
---    `;
    const p = tl`\
\
${''}
 Alpha${'Beta'}
   ${'Gamma'}
     Delta`;
    const xo = '\n AlphaBeta\n   Gamma\n     Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });
});

describe('transform: first expression that can not be marker', () => {
  test('ArrayExpression', () => {
    const o = ttl`outdent``
      ${nq`[1, 'B']`}
      2
    `;
    const p = tl`${nq`[1, 'B']`}
2`;
    const xo = '1,B\n2';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('ArrowFunctionExpression', () => {
    const o = ttl`outdent``
      ${nq`() => 1`}
      2
    `;
    const p = tl`${nq`() => 1`}
2`;
    const xo = '() => 1\n2';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('AssignmentExpression, not [=, ||=, &&=, ??=]', () => {
    // += -= *= /= %= <<= >>= >>>= |= ^= &=
    const o = `(() => {
      let x = 0;
      return ${ttl`outdent``
        ${nq`x += 1`}
        2
      `};
    })()`;
    const p = `(() => {
      let x = 0;
      return ${tl`${nq`x += 1`}
2`};
    })()`;
    const xo = '1\n2';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('BinaryExpression', () => {
    // == != === !== < <= > >=  << >> >>> + - * / % | ^ & in instanceof
    const o = `(() => {
      const x = 1;
      return ${ttl`outdent``
        ${nq`x == 1`}
        2
      `};
    })()`;
    const p = `(() => {
      const x = 1;
      return ${tl`${nq`x == 1`}
2`};
    })()`;
    const xo = 'true\n2';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('ClassExpression', () => {
    const o = ttl`outdent``
      ${nq`class { }`}
      2
    `;
    const p = tl`${nq`class { }`}
2`;
    const xo = 'class { }\n2';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('FunctionExpression', () => {
    const o = ttl`outdent``
      ${nq`function () { return void 0 }`}
      2
    `;
    const p = tl`${nq`function () { return void 0 }`}
2`;
    const xo = 'function () { return void 0 }\n2';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('ImportExpression', () => {
    const o = ttl`outdent``
      ${nq`import('outdent')`}
      2
    `;
    const p = tl`${nq`import('outdent')`}
2`;
    // Jest 29.6.0 disallows eval-ing this import
    // const xo = '[object Promise]\n2';
    // const eo = eval(o);

    // expect(eo).toBe(xo);
    // expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('Literal', () => {
    const o = ttl`outdent``
      ${nq`1n`}
      2
    `;
    const p = tl`${nq`1n`}
2`;
    const xo = '1\n2';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('ObjectExpression', () => {
    const o = ttl`outdent``
      ${nq`{ toString() { return 1 } }`}
      2
    `;
    const p = tl`${nq`{ toString() { return 1 } }`}
2`;
    const xo = '1\n2';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('TemplateLiteral', () => {
    const o = ttl`outdent``
      ${nq('`${outdent}`')}
      2
    `;
    const p = tl`${nq('`${outdent}`')}
2`;
    const xo = testOutdent.toString() + '\n2';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('UnaryExpression', () => {
    // - +  ! ~ typeof void delete
    const o = ttl`outdent``
      ${nq`+outdent`}
      2
    `;
    const p = tl`${nq`+outdent`}
2`;
    const xo = 'NaN\n2';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('UpdateExpression', () => {
    // prefix or postfix ++ --
    const o = `(() => {
      let out = outdent;
      return ${ttl`outdent``
      ${nq`++out`}
      2
    `};
    })()`;
    const p = `(() => {
      let out = outdent;
      return ${tl`${nq`++out`}
2`};
    })()`;
    const xo = 'NaN\n2';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });
});

describe('transform: first expression that can be marker', () => {
  test.each([
    ['AssignmentExpression, =',
      `(() => {
        let x;
        return ${ttl`outdent``   \

          ${nq`x = outdent`}
          2
        `};
      })()`,
      `(() => {
        let x;
        return ${ttl`outdent``
${nq`x = outdent`}
2
`};
      })()`],
    ['AssignmentExpression, ||=',
      `(() => {
        let x;
        return ${ttl`outdent``   \

          ${nq`x ||= outdent`}
          2
        `};
      })()`,
      `(() => {
        let x;
        return ${ttl`outdent``
${nq`x ||= outdent`}
2
`};
      })()`],
    ['AssignmentExpression, &&=',
      `(() => {
        let x = true;
        return ${ttl`outdent``   \

          ${nq`x &&= outdent`}
          2
        `};
      })()`,
      `(() => {
        let x = true;
        return ${ttl`outdent``
${nq`x &&= outdent`}
2
`};
      })()`],
    ['AssignmentExpression, ??=',
      `(() => {
        let x;
        return ${ttl`outdent``   \

          ${nq`x ??= outdent`}
          2
        `};
      })()`,
      `(() => {
        let x;
        return ${ttl`outdent``
${nq`x ??= outdent`}
2
`};
      })()`],
    ['CallExpression',
      ttl`outdent``   \

        ${nq`(() => outdent)()`}
        2
      `,
      ttl`outdent``
${nq`(() => outdent)()`}
2
`],
    ['ChainExpression',
      `(() => {
        const x = { o: outdent };
        return ${ttl`outdent``   \

        ${nq`x?.o`}
        2
      `}})()`,
      `(() => {
        const x = { o: outdent };
        return ${ttl`outdent``
${nq`x?.o`}
2
`}})()`],
    ['ConditionalExpression',
      ttl`outdent``   \

        ${nq`true ? outdent : void 0`}
        2
      `,
      ttl`outdent``
${nq`true ? outdent : void 0`}
2
`],
    ['Identifier (unrecognized)',
      // we do recognize some identifiers, but only imported identifiers and derived consts
      `(() => {
        let x = outdent;
        return ${ttl`outdent``   \

          ${nq`x`}
          2
        `};
      })()`,
      `(() => {
        let x = outdent;
        return ${ttl`outdent``
${nq`x`}
2
`};
      })()`],
    ['LogicalExpression',
      // falsy ||, truthy &&, nullish ??
      `(() => {
        const x = false;
        return ${ttl`outdent``   \

        ${nq`x || outdent`}
        2
      `};
      })()`,
      `(() => {
        const x = false;
        return ${ttl`outdent``
${nq`x || outdent`}
2
`};
      })()`],
    ['MemberExpression',
      // we do recognize some member expressions, but only of imported namespace identifiers and derived consts
      `(() => {
        const x = { o: outdent };
        return ${ttl`outdent``   \

        ${nq`x.o`}
        2
      `};
      })()`,
      `(() => {
        const x = { o: outdent };
        return ${ttl`outdent``
${nq`x.o`}
2
`};
      })()`],
    ['SequenceExpression',
      ttl`outdent``   \

        ${nq`(void 1), outdent`}
        2
      `,
      ttl`outdent``
${nq`(void 1), outdent`}
2
`],
    ['TaggedTemplateExpression',
      `(() => {
        const t = s => outdent;
        return ${ttl`outdent``   \

        ${nq(ttl`t```)}
        2
      `};
      })()`,
      `(() => {
        const t = s => outdent;
        return ${ttl`outdent``
${nq(ttl`t```)}
2
`};
      })()`],
    ['ThisExpression',
      `(function () {
        return ${ttl`outdent``   \

        ${nq`this`}
        2
      `};
      }).call(outdent)`,
      `(function () {
        return ${ttl`outdent``
${nq`this`}
2
`};
      }).call(outdent)`],
    ['YieldExpression',
      `(() => {
        const g = (function* () {
          return ${ttl`outdent``   \

            ${nq`yield`}
            2
          `};
        })();
        g.next();
        return g.next(outdent).value;
      })()`,
      `(() => {
        const g = (function* () {
          return ${ttl`outdent``
${nq`yield`}
2
`};
        })();
        g.next();
        return g.next(outdent).value;
      })()`],
  ])('%s', (...[, o, p]) => {
    const xo = '2';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('AwaitExpression', async () => {
    const o = `(async () => ${ttl`outdent``   \

      ${nq`await Promise.resolve(outdent)`}
      2
            `})()`;
    const p = `(async () => ${ttl`outdent``
${nq`await Promise.resolve(outdent)`}
2
`})()`;
    const xo = '2';
    const eo = await eval(o);

    expect(eo).toBe(xo);
    expect(await eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });
});

describe('transform: import variations', () => {
  test.each([
    // default (these first two) works in Node, but TS gets confused
    // TS sees the default export as only a namespace-like export: {outdent:fn,default:fn}, thus thinks it is not callable
    ['default', 'defaultOutdent'],
    ['renamed outdent', 'renamedOutdent'],
    ['outdent default', 'namedDefaultOutdent'],
  ])('identifier import: %s', (...[, importName]) => {
    const o = ttl`${importName}``
      AlphaBeta
        Gamma
          Delta
    `;
    const p = tl`AlphaBeta
  Gamma
    Delta`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('namespace', () => {
    const o = ttl`outdentNS.outdent``
      AlphaBeta
        Gamma
          Delta
    `;
    const c = ttl`outdentNS['outdent']``
      AlphaBeta
        Gamma
          Delta
    `;
    const d = ttl`outdentNS.default``
      AlphaBeta
        Gamma
          Delta
    `;
    const p = tl`AlphaBeta
  Gamma
    Delta`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(c)).toBe(eo);
    expect(eval(d)).toBe(eo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
    expect(transform(c)).toBe(p);
    expect(transform(d)).toBe(p);
  });
});

describe('transform: options', () => {
  test.each([
    ['empty object',
      ttl`outdent({})``
        AlphaBeta
          Gamma
            Delta
      `],
    ['only extraneous keys',
      ttl`outdent({ foo: 1, get bar() { return 2 } })``
        AlphaBeta
          Gamma
            Delta
      `],
  ])('%s', (...[, o]) => {
    const p = tl`AlphaBeta
  Gamma
    Delta`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['opt: false',
      ttl`outdent({ trimLeadingNewline: false })``   \

        AlphaBeta
          Gamma
            Delta
      `],
    ['opt: 0',
      ttl`outdent({ trimLeadingNewline: 0 })``   \

        AlphaBeta
          Gamma
            Delta
      `],
    ["opt: ''",
      ttl`outdent({ trimLeadingNewline: '' })``   \

        AlphaBeta
          Gamma
            Delta
      `],
    ['opt: null',
      ttl`outdent({ trimLeadingNewline: null })``   \

        AlphaBeta
          Gamma
            Delta
      `],
    ['opt: void x',
      ttl`outdent({ trimLeadingNewline: void 0 })``   \

        AlphaBeta
          Gamma
            Delta
      `],
    ['opt: ``',
      ttl`outdent({ trimLeadingNewline: ${tl``} })``   \

        AlphaBeta
          Gamma
            Delta
      `],
    ["'opt': false",
      ttl`outdent({ 'trimLeadingNewline': false })``   \

        AlphaBeta
          Gamma
            Delta
      `],
    ["['opt']: false",
      ttl`outdent({ ['trimLeadingNewline']: false })``   \

        AlphaBeta
          Gamma
            Delta
      `],
    ['[`opt`]: false',
      ttl`outdent({ [${tl`trimLeadingNewline`}]: false })``   \

        AlphaBeta
          Gamma
            Delta
      `],
    ['...{…}, prop:value',
      ttl`outdent({ ...{ trimLeadingNewline: true }, [${tl`trimLeadingNewline`}]: false })``   \

        AlphaBeta
          Gamma
            Delta
      `],
    ['...{…},...{prop:value}',
      ttl`outdent({ ...{ trimLeadingNewline: true }, ...{ [${tl`trimLeadingNewline`}]: false } })``   \

        AlphaBeta
          Gamma
            Delta
      `],
    ['({…})({prop:value})',
      ttl`outdent({ trimLeadingNewline: true })({ [${tl`trimLeadingNewline`}]: false })``   \

        AlphaBeta
          Gamma
            Delta
      `],
  ])('trimLeadingNewline falsy: %s', (...[, o]) => {
    // trimTrailingNewline uses same parsing code paths
    const p = tl`   \

AlphaBeta
  Gamma
    Delta`;
    const xp = '   \nAlphaBeta\n  Gamma\n    Delta';
    const ep = eval(p);

    expect(ep).toBe(xp);
    expect(eval(o)).toBe(xp);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['identifier',
      ttl`outdent({ get trimTrailingNewline() { return true } })``   \

        AlphaBeta
          Gamma
            Delta
      `,
      ttl`outdent({ get trimTrailingNewline() { return true } })``
AlphaBeta
  Gamma
    Delta
`],
    ['computed literal',
      ttl`outdent({ get ['trimTrailingNewline']() { return true } })``   \r\
        AlphaBeta
          Gamma
            Delta
      `,
      ttl`outdent({ get ['trimTrailingNewline']() { return true } })``\rAlphaBeta
  Gamma
    Delta
`],
    ['computed simple template literal',
      ttl`outdent({ get [${tl`trimTrailingNewline`}]() { return true } })``   \r\n\
        AlphaBeta
          Gamma
            Delta
      `,
      ttl`outdent({ get [${tl`trimTrailingNewline`}]() { return true } })``\r\nAlphaBeta
  Gamma
    Delta
`],
    ['identifier (and getter on other)',
      ttl`outdent({ trimTrailingNewline: true, get newline() { return null } })``   \r\n\
        AlphaBeta
          Gamma
            Delta
                `,
      ttl`outdent({ trimTrailingNewline: true, get newline() { return null } })``\r\nAlphaBeta
  Gamma
    Delta
`],
  ])('option with %s getter for static key makes only its value unknowable', (...[, o, p]) => {
    // to make sure the runtime outdent detects indentation at the correct
    // place, the transformation needs to leave a leading line break (though
    // extra spaces can be removed)
    const xo = 'AlphaBeta\n  Gamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  const i = <T>(v: T): T => v;
  const u = { trimTrailingNewline: false, trimLeadingNewline: false };
  const a = [u];
  void i, u, a; // used in eval

  test.each([
    ['non-simple computed property key',
      ttl`outdent({ trimTrailingNewline: false, [i('trimLeadingNewline')]: false })``   \

        AlphaBeta
          Gamma
            Delta
      `, ttl`outdent({ trimTrailingNewline: false, [i('trimLeadingNewline')]: false })``   \

AlphaBeta
  Gamma
    Delta
`],
    ['getter of non-simple computed property key',
      ttl`outdent({ trimTrailingNewline: false, get [i('trimLeadingNewline')]() { return false } })``   \

        AlphaBeta
          Gamma
            Delta
    `, ttl`outdent({ trimTrailingNewline: false, get [i('trimLeadingNewline')]() { return false } })``   \

AlphaBeta
  Gamma
    Delta
`],
    ['options uses object spread of non-static value (e.g. identifier)',
      ttl`outdent({ ...{ extra: 1 }, ...u })``   \

        AlphaBeta
          Gamma
            Delta
    `, ttl`outdent({ ...{ extra: 1 }, ...u })``   \

AlphaBeta
  Gamma
    Delta
`],
    ['options argument is a non-static value (e.g. identifier)',
      ttl`outdent(u)``   \

        AlphaBeta
          Gamma
            Delta
    `, ttl`outdent(u)``   \

AlphaBeta
  Gamma
    Delta
`],
    ['outdent argument is spread of a non-static value (e.g. identifier)',
      ttl`outdent(...a)``   \

        AlphaBeta
          Gamma
            Delta
    `, ttl`outdent(...a)``   \

AlphaBeta
  Gamma
    Delta
`],
    ['outdent argument is spread of array literal with a non-static value (e.g. identifier)',
      ttl`outdent(...[u])``   \

        AlphaBeta
          Gamma
            Delta
    `, ttl`outdent(...[u])``   \

AlphaBeta
  Gamma
    Delta
`],
    ['outdent argument is spread spread of array literal that spreads a non-static value (e.g. identifier)',
      ttl`outdent(...[...a])``   \

        AlphaBeta
          Gamma
            Delta
    `, ttl`outdent(...[...a])``   \

AlphaBeta
  Gamma
    Delta
`],
  ])('all options become unknowable: %s', (...[, o, p]) => {
    const xo = '   \nAlphaBeta\n  Gamma\n    Delta\n';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['object expression',
      ttl`outdent(...[{ trimTrailingNewline: false }])``   \

        AlphaBeta
          Gamma
            Delta
    `],
    ['object expression between spread empty array expressions',
      ttl`outdent(...[], { trimTrailingNewline: false }, ...[])``   \

        AlphaBeta
          Gamma
            Delta
    `],
    ['[spread array expression of an object expression] between spread empty array expressions',
      ttl`outdent(...[], ...[{ trimTrailingNewline: false }], ...[])``   \

        AlphaBeta
          Gamma
            Delta
    `],
    ['spread array expression of [object expression between spread empty array expressions]',
      ttl`outdent(...[...[], { trimTrailingNewline: false }, ...[]])``   \

        AlphaBeta
          Gamma
            Delta
    `],
  ])('outdent argument spreading: %s', (...[, o]) => {
    const p = tl`AlphaBeta
  Gamma
    Delta
`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta\n';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['identifier',
      ttl`outdent({ set trimTrailingNewline(v) {} })``   \

        AlphaBeta
          Gamma
            Delta
      `],
    ['computed literal',
      ttl`outdent({ set ['trimTrailingNewline'](v) {} })``   \

        AlphaBeta
          Gamma
            Delta
      `],
  ])('%s setter without getter (in same object expression; or later) or subsequent init #%#', (...[, o]) => {
    const p = tl`AlphaBeta
  Gamma
    Delta
`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta\n';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['identifier setter and getter',
      ttl`outdent({ set trimTrailingNewline(v) {}, get trimTrailingNewline() { return false } })``   \

        AlphaBeta
          Gamma
            Delta
      `,
      ttl`outdent({ set trimTrailingNewline(v) {}, get trimTrailingNewline() { return false } })``
AlphaBeta
  Gamma
    Delta
`
    ],
    ['identifier getter and setter',
      ttl`outdent({ get trimTrailingNewline() { return false }, set trimTrailingNewline(v) {} })``   \

        AlphaBeta
          Gamma
            Delta
      `,
      ttl`outdent({ get trimTrailingNewline() { return false }, set trimTrailingNewline(v) {} })``
AlphaBeta
  Gamma
    Delta
`
    ],
    ['computed literal setter and getter',
      ttl`outdent({ set ['trimTrailingNewline'](v) {}, get ['trimTrailingNewline']() { return false } })``   \

        AlphaBeta
          Gamma
            Delta
      `,
      ttl`outdent({ set ['trimTrailingNewline'](v) {}, get ['trimTrailingNewline']() { return false } })``
AlphaBeta
  Gamma
    Delta
`
    ],
    ['computed literal getter and setter',
      ttl`outdent({ get ['trimTrailingNewline']() { return false }, set ['trimTrailingNewline'](v) {} })``   \

        AlphaBeta
          Gamma
            Delta
      `,
      ttl`outdent({ get ['trimTrailingNewline']() { return false }, set ['trimTrailingNewline'](v) {} })``
AlphaBeta
  Gamma
    Delta
`
    ],
  ])('setter in options: %s', (...[, o, p]) => {
    const xo = 'AlphaBeta\n  Gamma\n    Delta\n';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('non-static-computed setter without subsequent inits', () => {
    const o = ttl`outdent({ set [i('trimTrailingNewline')](v) {} })``   \

      AlphaBeta
        Gamma
          Delta
    `;
    const p = ttl`outdent({ set [i('trimTrailingNewline')](v) {} })``   \

AlphaBeta
  Gamma
    Delta
`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta\n';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('non-static-computed setter with subsequent inits', () => {
    const o = ttl`outdent({
      set [i('trimTrailingNewline')](v) {},
      trimLeadingNewline: true, trimTrailingNewline: false, newline: null
    })``   \

      AlphaBeta
        Gamma
          Delta
    `;
    const p = tl`AlphaBeta
  Gamma
    Delta
`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta\n';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['string literal', `'<nl>'`],
    ['simple template literal', tl`<nl>`],
  ])('newline: %s (trim trailing: false)', (...[, nl]) => {
    const o = ttl`outdent({ newline: ${nl}, trimTrailingNewline: false })``   \
\r      AlphaBeta\n        Gamma\r\n          Delta\r    `;
    const p = tl`AlphaBeta<nl>  Gamma<nl>    Delta<nl>`;
    const xo = 'AlphaBeta<nl>  Gamma<nl>    Delta<nl>';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('newline: string literal (trim leading: false)', () => {
    const o = ttl`outdent({ newline: '<nl>', trimLeadingNewline: false })``   \
\r      AlphaBeta\n        Gamma\r\n          Delta\r    `;
    const p = tl`   <nl>AlphaBeta<nl>  Gamma<nl>    Delta`;
    const xo = '   <nl>AlphaBeta<nl>  Gamma<nl>    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('newline: string literal (no extras in leading or trailing)', () => {
    const o = ttl`outdent({ newline: '<nl>' })``\r      AlphaBeta\n        Gamma\r\n          Delta\r`;
    const p = tl`AlphaBeta<nl>  Gamma<nl>    Delta`;
    const xo = 'AlphaBeta<nl>  Gamma<nl>    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('newline: string literal (multiple exprs)', () => {
    const o = ttl`outdent({ newline: '<nl>' })``   \
\r      Alpha${'Beta'}\n        Gamma\r\n${'Delta'}\r`;
    const p = tl`Alpha${'Beta'}<nl>  Gamma<nl>${'Delta'}`;
    const xo = 'AlphaBeta<nl>  Gamma<nl>Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('newline: null', () => {
    const o = ttl`outdent({ newline: null })``   \
\r      AlphaBeta\n        Gamma\r\n          Delta\r           `;
    const p = tl`AlphaBeta\n  Gamma\r\n    Delta`;
    const xo = 'AlphaBeta\n  Gamma\r\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['LF+', '\n<'],
    ['+LF', '>\n'],
    ['+LF+', '>\n<'],
    ['LF,LF', '\n\n'],
    ['CRLF+', '\r\n<'],
    ['+CRLF', '>\r\n'],
    ['+CRLF+', '>\r\n<'],
    ['CRLF,CRLF', '\r\n\r\n'],
    ['CR+', '\r<'],
    ['+CR', '>\r'],
    ['+CR+', '>\r<'],
    ['CR,CR', '\r\r'],
  ])('when retaining the tag, line breaks can not be substituted if it has a line break and anything else: %s', (...[, x]) => {
    const o = ttl`outdent({ newline: ${JSON.stringify(x)}, trimLeadingNewline: (0,true) })``   \

      AlphaBeta
        Gamma
          Delta
    `;
    const p = ttl`outdent({ newline: ${JSON.stringify(x)}, trimLeadingNewline: (0,true) })``   \

AlphaBeta
  Gamma
    Delta
`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta'.split('\n').join(x);
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['LF+', '\n<'],
    ['+LF', '>\n'],
    ['+LF+', '>\n<'],
    ['LF,LF', '\n\n'],
    ['CRLF+', '\r\n<'],
    ['+CRLF', '>\r\n'],
    ['+CRLF+', '>\r\n<'],
    ['CRLF,CRLF', '\r\n\r\n'],
    ['CR+', '\r<'],
    ['+CR', '>\r'],
    ['+CR+', '>\r<'],
    ['CR,CR', '\r\r'],
    ['<no line break>', ']['],
  ])('when removing the tag, line breaks can always be substituted: %s', (...[, x]) => {
    const xEscaped = x.replaceAll('\r', '\\r');
    const o = ttl`outdent({ newline: ${JSON.stringify(x)} })``   \

      AlphaBeta
        Gamma
          Delta
    `;
    const p = tl`AlphaBeta${nx(xEscaped)}  Gamma${nx(xEscaped)}    Delta`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta'.split('\n').join(x);
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });
});

describe('transform: tag left when any non-static option or marker', () => {
  // leaving the tag means that we can not do full leading and trailing
  // trimming, can not do line break substitution (since replacement might be
  // more than just a line break variant), and might not be able to remove an
  // indentation marker

  // if we were willing to rewrite the effective options, we could fully apply
  // the statically known ones and turn them off in the transformed version...
  test('non-static trimLeadingNewline', () => {
    // can not trim spaces before leading line break
    // can substitute line breaks (since it does not have a line break)
    // can trim spaces beyond indentation after trailing line break
    const o = ttl`outdent({ trimLeadingNewline: (0,true), newline: '<nl>', trimTrailingNewline: true })``         \

    \

    AlphaBeta
   #  Gamma
   #    Delta
   #
   #     `;
    const p = ttl`outdent({ trimLeadingNewline: (0,true), newline: '<nl>', trimTrailingNewline: true })``         \

<nl>AlphaBeta<nl>  Gamma<nl>    Delta<nl>
`;
    const xo = '<nl>AlphaBeta<nl>  Gamma<nl>    Delta<nl>';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('non-static newline', () => {
    // can trim spaces before leading line break
    // can trim spaces beyond indentation after trailing line break
    // can not substitute line breaks
    const o = ttl`outdent({ trimLeadingNewline: true, newline: (0,'<nl>'), trimTrailingNewline: true })``         \

    \

    AlphaBeta
   #  Gamma
   #    Delta
   #
   #     `;
    const p = ttl`outdent({ trimLeadingNewline: true, newline: (0,'<nl>'), trimTrailingNewline: true })``

AlphaBeta
  Gamma
    Delta

`;
    const xo = '<nl>AlphaBeta<nl>  Gamma<nl>    Delta<nl>';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('non-static trimTrailingNewline', () => {
    // can trim spaces before leading line break
    // can substitute line breaks (since it does not have a line break)
    // can not trim spaces beyond indentation after trailing line break
    const o = ttl`outdent({ trimLeadingNewline: true, newline: '<nl>', trimTrailingNewline:(0,true) })``         \

    \

    AlphaBeta
   #  Gamma
   #    Delta
   #
   #     `;
    const p = ttl`outdent({ trimLeadingNewline: true, newline: '<nl>', trimTrailingNewline:(0,true) })``
<nl>AlphaBeta<nl>  Gamma<nl>    Delta<nl>
     `;
    const xo = '<nl>AlphaBeta<nl>  Gamma<nl>    Delta<nl>';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('non-static indentation marker', () => {
    // can trim spaces before leading line break; can trim indentation before possible marker
    // can substitute line breaks (since it does not have a line break)
    // can trim spaces beyond indentation after trailing line break
    const o = ttl`outdent({ trimLeadingNewline: true, newline: '<nl>', trimTrailingNewline: true })``         \

    \

    ${nq`0,outdent`}
    \

    AlphaBeta
   #  Gamma
   #    Delta
   #
   #     `;
    const p = ttl`outdent({ trimLeadingNewline: true, newline: '<nl>', trimTrailingNewline: true })``

${nq`0,outdent`}
<nl>AlphaBeta<nl>  Gamma<nl>    Delta<nl>
`;
    const xo = '<nl>AlphaBeta<nl>  Gamma<nl>    Delta<nl>';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('definite indentation marker must be preserved if next expression could also be a marker', () => {
    // otherwise the runtime outdent might detect that next expression as a
    // marker (which would have been impossible in the original template
    // literal)

    // realistically, this is probably a coding error in the original template
    // literal since such a construction would dump the code of the outdent
    // function in to the string value...

    // "non-static" newline option is used here just to force tag retention
    const o = ttl`outdent({ trimLeadingNewline: true, newline: (0,null), trimTrailingNewline: true })``         \

    \

    ${nq`outdent`}
    \

      ${nq`outdent`}
    AlphaBeta
   #  Gamma
   #    Delta
   #
   #     `;
    const p = ttl`outdent({ trimLeadingNewline: true, newline: (0,null), trimTrailingNewline: true })``

${nq`outdent`}

  ${nq`outdent`}
AlphaBeta
  Gamma
    Delta

`;
    const xo = '\n  ' + outdent.toString() + '\nAlphaBeta\n  Gamma\n    Delta\n';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });
});

describe('transform: const bindings', () => {
  test.each([
    ['global const',
      'const b_outdent = outdent;',
      ''],
    ['global const of global const',
      'const g_outdent = outdent; const b_outdent = g_outdent;',
      ''],
    ['local const',
      '',
      'const b_outdent = outdent;'],
    ['local const of local const',
      '',
      'const l_outdent = outdent; const b_outdent = l_outdent;'],
    ['local const of global const',
      'const g_outdent = outdent;',
      'const b_outdent = g_outdent;'],
  ])('%s of import', (...[, global, local]) => {
    const o = `
      ${global}
      (()=>{
        ${local}
        return ${ttl`b_outdent``
          AlphaBeta
            Gamma
              Delta
          `};
      })()`;
    const p = `
      ${global}
      (()=>{
        ${local}
        return ${tl`AlphaBeta
  Gamma
    Delta`};
      })()`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('inside function expression', () => {
    const o = `
      const b_outdent = outdent;
      (function b_outdent(...args) {
        if (false) ${ttl`b_outdent``
          AlphaBeta
            Gamma
              Delta
          `};
        return outdent(...args);
      });
    `;

    expect(transform(o)).toBe(o);
  });

  test.each([
    ['global',
      'let b_outdent = outdent;',
      ''],
    ['local',
      '',
      'let b_outdent = outdent;'],
    ['local shadows const global',
      'const b_outdent = outdent;',
      'let b_outdent = outdent;'],
    ['local (via array pattern) shadows const global',
      'const b_outdent = outdent;',
      'let [b_outdent] = [outdent];'],
    ['local (via object pattern) shadows const global',
      'const b_outdent = outdent;',
      'let {x:b_outdent} = {x:outdent};'],
    ['local function declaration shadows const global',
      'const b_outdent = outdent;',
      'function b_outdent(...args){return outdent(...args)}'],
  ])('non-const %s', (...[, global, local]) => {
    const o = `
      ${global}
      (()=>{
        ${local}
        return ${ttl`b_outdent``
          AlphaBeta
            Gamma
              Delta
          `};
      })()`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(transform(o)).toBe(o);
  });

  test.each([
    ['global const',
      'const b_outdent = outdentNS;',
      ''],
    ['global const of global const',
      'const g_outdent = outdentNS; const b_outdent = g_outdent;',
      ''],
    ['local const',
      '',
      'const b_outdent = outdentNS;'],
    ['local const of local const',
      '',
      'const l_outdent = outdentNS; const b_outdent = l_outdent;'],
    ['local const of global const',
      'const g_outdent = outdentNS;',
      'const b_outdent = g_outdent;'],
  ])('%s of namespace', (...[, global, local]) => {
    const o = `
      ${global}
      (()=>{
        ${local}
        return ${ttl`b_outdent.outdent``
          AlphaBeta
            Gamma
              Delta
          `};
      })()`;
    const p = `
      ${global}
      (()=>{
        ${local}
        return ${tl`AlphaBeta
  Gamma
    Delta`};
      })()`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['global',
      'let b_outdent = outdentNS;',
      ''],
    ['local',
      '',
      'let b_outdent = outdentNS;'],
    ['local shadows const global',
      'const b_outdent = outdentNS;',
      'let b_outdent = outdentNS;'],
    ['local (via array pattern) shadows const global',
      'const b_outdent = outdentNS;',
      'let [b_outdent] = [outdentNS];'],
    ['local (via object pattern) shadows const global',
      'const b_outdent = outdentNS;',
      'let {x:b_outdent} = {x:outdentNS};'],
    ['local function declaration shadows const global',
      'const b_outdent = outdentNS;',
      'function b_outdent(){}Object.assign(b_outdent,outdentNS)'],
  ])('non-const %s of namespace', (...[, global, local]) => {
    const o = `
      ${global}
      (()=>{
        ${local}
        return ${ttl`b_outdent.outdent``
          AlphaBeta
            Gamma
              Delta
          `};
      })()`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(transform(o)).toBe(o);
  });

  test.each([
    ['global const of options',
      'const b_outdent = outdent({trimLeadingNewline: false, trimTrailingNewline: false, newline: `.NL.`});',
      '',
      'b_outdent'],
    ['global const of options of global const of options',
      'const g_outdent = outdent({trimLeadingNewline: false, trimTrailingNewline: false}); const b_outdent = g_outdent({newline: `.NL.`});',
      '',
      'b_outdent'],
    ['options of global const of options of global const of options',
      'const g_outdent = outdent({trimLeadingNewline: false}); const b_outdent = g_outdent({trimTrailingNewline: false});',
      '',
      'b_outdent({newline: `.NL.`})'],
    ['local const of options',
      '',
      'const b_outdent = outdent({trimLeadingNewline: false, trimTrailingNewline: false, newline: `.NL.`});',
      'b_outdent'],
    ['local const of options of local const of options',
      '',
      'const l_outdent = outdent({trimLeadingNewline: false, trimTrailingNewline: false}); const b_outdent = l_outdent({newline: `.NL.`});',
      'b_outdent'],
    ['options of local const of options of local const of options',
      '',
      'const l_outdent = outdent({trimLeadingNewline: false}); const b_outdent = l_outdent({trimTrailingNewline: false});',
      'b_outdent({newline: `.NL.`})'],
    ['options of local const of options of global const of options',
      'const g_outdent = outdent({trimLeadingNewline: false});',
      ' const l_outdent = g_outdent({trimTrailingNewline: false});',
      'l_outdent({newline: `.NL.`})'],
  ])('%s of import', (...[, global, local, expr]) => {
    const o = `
      ${global}
      (()=>{
        ${local}
        return ${ttl`${expr}``
          AlphaBeta
            Gamma
              Delta
          `};
      })()`;
    const p = `
      ${global}
      (()=>{
        ${local}
        return ${tl`.NL.AlphaBeta.NL.  Gamma.NL.    Delta.NL.`};
      })()`;
    const xo = '.NL.AlphaBeta.NL.  Gamma.NL.    Delta.NL.';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['global const of options',
      'const b_outdent = outdentNS.default({trimLeadingNewline: false, trimTrailingNewline: false, newline: `.NL.`});',
      '',
      'b_outdent'],
    ['local const of options of global const',
      'const g_outdent = outdentNS.default;',
      'const b_outdent = g_outdent({trimLeadingNewline: false, trimTrailingNewline: false, newline: `.NL.`});',
      'b_outdent'],
    ['options of local const of options of global const',
      'const g_outdent = outdentNS.default;',
      'const b_outdent = g_outdent({trimLeadingNewline: false, trimTrailingNewline: false});',
      'b_outdent({newline: `.NL.`})'],
  ])('%s of property of namespace import', (...[, global, local, expr]) => {
    const o = `
      ${global}
      (()=>{
        ${local}
        return ${ttl`${expr}``
          AlphaBeta
            Gamma
              Delta
          `};
      })()`;
    const p = `
      ${global}
      (()=>{
        ${local}
        return ${tl`.NL.AlphaBeta.NL.  Gamma.NL.    Delta.NL.`};
      })()`;
    const xo = '.NL.AlphaBeta.NL.  Gamma.NL.    Delta.NL.';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test.each([
    ['marker as global const of import',
      'const b_outdent = outdent, g_outdent = outdent;',
      '',
      'g_outdent({trimLeadingNewline: false, trimTrailingNewline: false, newline: `.NL.`})'],
    ['marker as local const of import',
      '',
      'const b_outdent = outdent, l_outdent = outdent;',
      'l_outdent({trimLeadingNewline: false, trimTrailingNewline: false, newline: `.NL.`})'],
    ['marker as global const of options of import',
      'const b_outdent = outdent({trimLeadingNewline: false, trimTrailingNewline: false, newline: `.NL.`});',
      '',
      'b_outdent'],
    ['marker as local const of options of import',
      '',
      'const b_outdent = outdent({trimLeadingNewline: false, trimTrailingNewline: false, newline: `.NL.`});',
      'b_outdent'],
  ])('%s', (...[, global, local, expr]) => {
    const o = `
      ${global}
      (()=>{
        ${local}
        return ${ttl`${expr}``
          ${nq`b_outdent`}
          AlphaBeta
            Gamma
              Delta
          `};
      })()`;
    const p = `
      ${global}
      (()=>{
        ${local}
        return ${tl`.NL.AlphaBeta.NL.  Gamma.NL.    Delta.NL.`};
      })()`;
    const xo = '.NL.AlphaBeta.NL.  Gamma.NL.    Delta.NL.';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });
});

describe('transform: special stuff', () => {
  test('literal non-BMP code point in non-first indent region', () => {
    const o = ttl`outdent``
      AlphaBeta
🌌      Gamma
          Delta
    `;
    const p = tl`AlphaBeta
  Gamma
    Delta`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('\\u{}-sequence non-BMP code point in non-first indent region', () => {
    const o = ttl`outdent``
      AlphaBeta
\u{1f30c}      Gamma
\u{fffff}\u{100000}\u{10ffff}    Delta
    `;
    const p = tl`AlphaBeta
  Gamma
    Delta`;
    const xo = 'AlphaBeta\n  Gamma\n    Delta';
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(eval(p)).toBe(eo);
    expect(transform(o)).toBe(p);
  });

  test('var declaration is function-scoped', () => {
    const o = `
    (()=>{
      return outdent && ${ttl`outdent``
        AlphaBeta
          Gamma
            Delta
      `};
      if(false) { var outdent }
    })()
    `;
    const xo = void 0;
    const eo = eval(o);

    expect(eo).toBe(xo);
    expect(transform(o)).toBe(o);
  });
});
