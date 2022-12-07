import { describe, test, expect } from '@jest/globals';
import { reduceCSV, type Row } from 'utils';

describe('reduceCSV', () => {
  test('collect in array', async () => {
    const csv = `
      a,b,c c,d
      1,-2,three,04
      2,"two words","=""quotes""",k
    `.trimStart().split('\n').map(s => s.trim()).join('\n');
    const result = await reduceCSV(csv, {
      fn: (acc, row) => acc.concat([row]),
      initial: [] as Row[]
    });

    expect(result).toStrictEqual([
      { a: '1', b: '-2', 'c c': 'three', d: '04' },
      { a: '2', b: 'two words', 'c c': '="quotes"', d: 'k' }]);
  });
});