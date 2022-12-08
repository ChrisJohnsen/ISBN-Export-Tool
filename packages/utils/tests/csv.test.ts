import { describe, test, expect } from '@jest/globals';
import { reduceCSV, type Row } from 'utils';
import { outdent } from 'outdent';

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
