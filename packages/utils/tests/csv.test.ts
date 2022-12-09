import { describe, test, expect } from '@jest/globals';
import { reduceCSV, toCSV, type Row } from 'utils';
import { outdent } from 'outdent';

const outdentToCRLF = outdent({ newline: '\r\n' });

describe('reduceCSV', () => {
  const csv = outdent`
    a,b,c c,d
    1,-2,three,04
    2,"two words","=""quotes""",k
  `;

  test('collect in array', async () => {
    const result = await reduceCSV(csv, {
      fn: (acc, row) => acc.concat([row]),
      initial: [] as Row[]
    });

    expect(result).toStrictEqual([
      { a: '1', b: '-2', 'c c': 'three', d: '04' },
      { a: '2', b: 'two words', 'c c': '="quotes"', d: 'k' }]);
  });

  test('sum a column', async () => {
    const result = await reduceCSV(csv, {
      fn: (acc, row) => acc + parseInt(row.a),
      initial: 0
    });

    expect(result).toBe(3);
  });
});

describe('toCSV', () => {
  const objs = [
    { eh: '1', bee: 'B', sea: '3' },
    { bee: 'b', sea: 'three', eh: '2' },
  ];

  test('array of same shape objects', () => {
    const result = toCSV(objs);

    expect(result).toEqual(outdentToCRLF`
      eh,bee,sea
      1,B,3
      2,b,three
    `);
  });

  test('array of same shape objects, explict header', () => {
    const result = toCSV({ header: Object.keys(objs[0]), rows: objs });

    expect(result).toEqual(outdentToCRLF`
      eh,bee,sea
      1,B,3
      2,b,three
    `);

    const result2 = toCSV({ header: ['sea', 'bee'], rows: objs });

    expect(result2).toEqual(outdentToCRLF`
      sea,bee
      3,B
      three,b
    `);
  });

  const rows = [
    ['eh', 'bee', 'sea'],
    ['1', 'B', '3'],
    ['2', 'b', 'three'],
  ];
  const csv = outdentToCRLF`
    eh,bee,sea
    1,B,3
    2,b,three
  `;

  test('array of arrays', () => {
    const implictHeader = toCSV(rows);

    expect(implictHeader).toEqual(csv);

  });

  test('array of arrays, explict header', () => {
    const explicitHeadder = toCSV({ header: rows[0], rows: rows.slice(1) });

    expect(explicitHeadder).toEqual(csv);
  });
});
