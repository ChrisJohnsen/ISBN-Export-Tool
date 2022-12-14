import { describe, test, expect, jest } from '@jest/globals';
import { otherEditionsOfISBN, pipe, type Fetcher } from 'utils';

function keep(example: string | number | boolean | [] | [any] | Record<string, any>): (data: any) => any {
  if (['string', 'number', 'boolean'].includes(typeof example)) {
    return data => {
      if (typeof example != typeof data) throw `keep mismatch: expected ${typeof example}, got ${typeof data}`;
      return data;
    };
  } else if (Array.isArray(example)) {
    if (!example.length) return () => [];
    if (example.length != 1) throw `keep error: example arrays must be zero or one length`;
    const keptElement = example[0];
    return data => {
      if (!Array.isArray(data)) throw `keep mismatch: expected array, got ${typeof data}`;
      return data.map(keep(keptElement));
    };
  } else if (example && typeof example == 'object') {
    const keepKeys = Object.keys(example);
    return data => {
      if (['string', 'number', 'boolean'].includes(typeof data)) throw `keep mismatch: expected object, got ${typeof data}`;
      if (Array.isArray(data)) throw `keep mismatch: expected object, got array`;
      if (!data) throw 'keep mismatch: expected object, got nullish';
      return Object.fromEntries(Object.entries(data)
        .filter(([key]) => keepKeys.includes(key))
        .map(([key, data]) => [key, keep(example[key])(data)]));
    };
  } else {
    throw `keep mismatch: unexpected example type: ${typeof example}`;
  }
}

describe('keep', () => {
  test('string', () => expect(keep('')('str')).toBe('str'));

  test('number', () => expect(keep(0)(1)).toBe(1));

  test('empty array', () => expect(keep([])([1, 2, 3])).toStrictEqual([]));

  test('single element array', () => expect(keep([1])([1, 2, 3])).toStrictEqual([1, 2, 3]));

  test('two+ element array', () => expect(() => keep([1, 2])).toThrow());

  test('object', () =>
    expect(keep({ a: 'a', b: 2, c: false })({ a: 'A', b: 0, bee: null, c: true }))
      .toStrictEqual({ a: 'A', b: 0, c: true }));

  test.each([1, true, { obj: '' }, ['']])('string given non-string: %j', (value) => {
    expect(() => keep('a')(value)).toThrow();
  });

  test.each(['one', true, { obj: 'one' }, ['one']])('number given non-number: %j', (value) => {
    expect(() => keep(2)(value)).toThrow();
  });

  test.each(['true', 1, { obj: 'str' }, ['str']])('boolean given non-boolean: %j', (value) => {
    expect(() => keep(true)(value)).toThrow();
  });

  test.each(['str', 1, false, [1, 2, 3]])('object given non-object: %j', (value) => {
    expect(() => keep({})(value)).toThrow();
  });

  test.each(['str', 1, false, { a: 1 }])('array given non-array: %j', (value) => {
    expect(() => keep([1])(value)).toThrow();
  });

  test('array of array', () =>
    expect(keep([[1]])([[1], [2], [3]])).toStrictEqual([[1], [2], [3]]));

  test('array of object', () =>
    expect(keep([{ a: 'a' }])([{ a: 'A' }, { b: 'a' }, { b: 2, a: 'one' }]))
      .toStrictEqual([{ a: 'A' }, {}, { a: 'one' }]));

  test('object of object', () =>
    expect(keep({ a: 'str', o: { n: 1, b: true } })({ o: { n: 2, b: false }, a: '', bee: 'bumble' }))
      .toStrictEqual({ o: { n: 2, b: false }, a: '' }));

  test('object of array', () =>
    expect(keep({ a: 'str', as: [0] })({ a: '', bee: 'bumble', as: [1, 6, 1] }))
      .toStrictEqual({ a: '', as: [1, 6, 1] }));
});

function bookResponse(workId: string) {
  return {
    works: [{ key: `/works/${workId}` }],
  };
}

function editionsResponse(editionISBNs: (string | string[])[]) {
  function tagged(isbns: (string | string[])[]) {
    const tag = (isbn: string) => isbn.length == 10 ? { isbn_10: isbn } : { isbn_13: isbn };
    return isbns.map(is => Array.isArray(is) ? Object.assign({}, ...is.map(tag)) : tag(is));
  }
  return {
    entries: tagged(editionISBNs),
  };
}

function isbnURL(isbn: string) {
  return `https://openlibrary.org/isbn/${isbn}.json`;
}
function editionsURL(workId: string) {
  return `https://openlibrary.org/works/${workId}/editions.json`;
}

const toJ = JSON.stringify;

describe('edition fetcher', () => {
  test('minimal responses', async () => {
    const isbn = '9876543210';
    const workId = 'OL123456789W';
    const editionISBNs = ['9876543210', [], '8765432109876', ['7654321098', '6543210987654']];

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(
        pipe(bookResponse,
          keep({ works: [{ key: '' }] }),
          toJ)(workId))
      .mockResolvedValueOnce(
        pipe(editionsResponse,
          keep({ entries: [{ isbn_10: '', isbn_13: '' }] }),
          toJ)(editionISBNs));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveBeenNthCalledWith(2, editionsURL(workId));
    expect(fetcher).toHaveReturnedTimes(2);
    expect(result).toStrictEqual(editionISBNs.flat());
  });
});
