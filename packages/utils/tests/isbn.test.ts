import { describe, test, expect, jest } from '@jest/globals';
import { ContentError, otherEditionsOfISBN, pipe, type Fetcher } from 'utils';

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
  test('isbn fetch fails', async () => {
    const isbn = '9876543210';
    const err = 'failed to fetch isbn or its redirect';
    const fetcher = jest.fn<Fetcher>()
      .mockRejectedValueOnce(err);

    await expect(otherEditionsOfISBN(fetcher, isbn)).rejects.toBe(err);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);
  });

  test('isbn response not JSON', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce('just plain text, not JSON');

    await expect(() => otherEditionsOfISBN(fetcher, isbn)).rejects.toBeInstanceOf(ContentError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);
  });

  test('isbn response not object', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ(1));

    await expect(() => otherEditionsOfISBN(fetcher, isbn)).rejects.toBeInstanceOf(ContentError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);
  });

  test('work response missing .works', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ({}));

    await expect(() => otherEditionsOfISBN(fetcher, isbn)).rejects.toBeInstanceOf(ContentError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);
  });

  test('work response .works is empty', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ({ works: [] }));

    await expect(() => otherEditionsOfISBN(fetcher, isbn)).rejects.toBeInstanceOf(ContentError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);
  });

  test('work response missing works[n].key', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ({
        works: [
          { something: 'not key' },
          { other: 'also not key' },
          {},
        ]
      }));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);
    expect(result.isbns).toBeUndefined();
    expect(result.workFaults).toHaveLength(4);
    expect(result.editionsFaults).toStrictEqual([]);

    result.workFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
  });

  test('work response works[n].key does not .startWith(/works)', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ({
        works: [
          { something: 'not key', key: '/work/blah' },
          { key: '/w/blah2', other: 'also not key' },
          { key: 'blah3' },
        ]
      }));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);
    expect(result.isbns).toBeUndefined();
    expect(result.editionsFaults).toStrictEqual([]);
    expect(result.workFaults).toHaveLength(4);

    result.workFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
  });

  test('work response works[n].key: mix of valid, invalid and missing', async () => {
    const isbn = '9876543210';
    const workId = 'OL123456789W';
    const editionISBNs = ['9876543210', '8765432109'];

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ({
        works: [
          { key: 1234 },
          bookResponse(workId).works[0],
          { other: 'no key here' },
          { key: 'blah3-invalid-key' },
        ]
      }))
      .mockResolvedValueOnce(toJ(editionsResponse(editionISBNs)));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveBeenNthCalledWith(2, editionsURL(workId));
    expect(fetcher).toHaveReturnedTimes(2);
    expect(result.isbns).toStrictEqual(editionISBNs.flat());
    expect(result.editionsFaults).toStrictEqual([]);
    expect(result.workFaults).toHaveLength(3);

    result.workFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
  });

  test('editions fetch fails', async () => {
    const isbn = '9876543210';
    const workId = 'OL123456789W';
    const err = 'failed to fetch editions';
    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ(bookResponse(workId)))
      .mockRejectedValueOnce(err);

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveBeenNthCalledWith(2, editionsURL(workId));
    expect(fetcher).toHaveReturnedTimes(2);
    expect(result.isbns).toBeUndefined();
    expect(result.workFaults).toStrictEqual([]);
    expect(result.editionsFaults).toHaveLength(2);

    result.editionsFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
  });

  test('editions response not JSON', async () => {
    const isbn = '9876543210';
    const workId = 'OL123456789W';
    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ(bookResponse(workId)))
      .mockResolvedValueOnce('just plain text, not JSON');

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveBeenNthCalledWith(2, editionsURL(workId));
    expect(fetcher).toHaveReturnedTimes(2);
    expect(result.isbns).toBeUndefined();
    expect(result.workFaults).toStrictEqual([]);
    expect(result.editionsFaults).toHaveLength(2);

    result.editionsFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
  });

  test('editions response not an object', async () => {
    const isbn = '9876543210';
    const workId = 'OL123456789W';
    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ(bookResponse(workId)))
      .mockResolvedValueOnce('123');

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveBeenNthCalledWith(2, editionsURL(workId));
    expect(fetcher).toHaveReturnedTimes(2);
    expect(result.isbns).toBeUndefined();
    expect(result.workFaults).toStrictEqual([]);
    expect(result.editionsFaults).toHaveLength(2);

    result.editionsFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
  });

  test('editions response missing .entries', async () => {
    const isbn = '9876543210';
    const workId = 'OL123456789W';
    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ(bookResponse(workId)))
      .mockResolvedValueOnce(toJ({ count: 1 }));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveBeenNthCalledWith(2, editionsURL(workId));
    expect(fetcher).toHaveReturnedTimes(2);
    expect(result.isbns).toBeUndefined();
    expect(result.workFaults).toStrictEqual([]);
    expect(result.editionsFaults).toHaveLength(2);

    result.editionsFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
  });

  test('editions response .entries is empty', async () => {
    const isbn = '9876543210';
    const workId = 'OL123456789W';
    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ(bookResponse(workId)))
      .mockResolvedValueOnce(toJ({ entries: [] }));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveBeenNthCalledWith(2, editionsURL(workId));
    expect(fetcher).toHaveReturnedTimes(2);
    expect(result.isbns).toBeUndefined();
    expect(result.workFaults).toStrictEqual([]);
    expect(result.editionsFaults).toHaveLength(1);

    result.editionsFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
  });

  test('editions response .entries[n]: none has .isbn_10 or .isbn_13', async () => {
    const isbn = '9876543210';
    const workId = 'OL123456789W';
    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ(bookResponse(workId)))
      .mockResolvedValueOnce(toJ({ entries: [{ no_isbn: true }, { isbn_14: '!', isbn_12: '?' }, {}] }));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveBeenNthCalledWith(2, editionsURL(workId));
    expect(fetcher).toHaveReturnedTimes(2);
    expect(result.isbns).toBeUndefined();
    expect(result.workFaults).toStrictEqual([]);
    expect(result.editionsFaults).toHaveLength(4);

    result.editionsFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
  });

  test('multiple works, some invalid, multiple editions, some invalid', async () => {
    const isbn = '9876543210';
    const workId = 'OL123456789W';
    const workId2 = 'OL234567890W';
    const editionISBNs = ['9876543210', [], '8765432109876', ['7654321098', '6543210987654']];
    const editionISBNs2 = [[], '5432109876', ['4321098765432', '3210987654']];

    const fetcher = jest.fn<Fetcher>().mockImplementation(async url =>
      toJ((url => {
        if (url == isbnURL(isbn)) return {
          works: [
            { key: `/works/${workId}` },
            { key: '/work/invalid' },
            { key: `/works/${workId2}` }
          ],
        };
        if (url == editionsURL(workId))
          return editionsResponse(editionISBNs);
        if (url == editionsURL(workId2))
          return editionsResponse(editionISBNs2);
        throw `Unexpected URL to fetch: ${url}!`;
      })(url)));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveBeenCalledWith(editionsURL(workId));
    expect(fetcher).toHaveBeenCalledWith(editionsURL(workId2));
    expect(fetcher).toHaveReturnedTimes(3);
    expect(result.workFaults).toHaveLength(1);
    expect(result.editionsFaults).toHaveLength(2);
    expect(result.isbns?.slice().sort()).toStrictEqual(editionISBNs.concat(editionISBNs2).flat().sort());

    result.workFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
    result.editionsFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
  });
});
