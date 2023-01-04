import { describe, test, expect, jest } from '@jest/globals';
import { ContentError, EditionsISBNResults, equivalentISBNs, normalizeISBN, otherEditionsOfISBN, validateISBN, type Fetcher } from 'utils';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

function isbnURL(isbn: string) {
  return `https://openlibrary.org/isbn/${isbn}.json`;
}

const toJ = JSON.stringify;

describe('work response faults', () => {
  test('fetch fails', async () => {
    const isbn = '9876543210';
    const err = 'failed to fetch isbn or its redirect';
    const fetcher = jest.fn<Fetcher>()
      .mockRejectedValueOnce(err);

    await expect(otherEditionsOfISBN(fetcher, isbn)).rejects.toBe(err);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);
  });

  test('not JSON', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce('just plain text, not JSON');

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(result.isbns).toBeUndefined();
    expect(result.workFaults).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);
  });

  test('not object', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ(1));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(result.isbns).toBeUndefined();
    expect(result.workFaults).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);
  });

  test('missing .works', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ({}));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(result.isbns).toBeUndefined();
    expect(result.workFaults).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);
  });

  test('.works is empty', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ({ works: [] }));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(result.isbns).toBeUndefined();
    expect(result.workFaults).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);
  });

  test('missing works[n].key', async () => {
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

  test('works[0].key (only one) invalid', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ({ works: [{ key: 'blah1' },] }));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(result.isbns).toBeUndefined();
    expect(result.workFaults).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);
  });

  test('works[n].key does not .startWith(/works)', async () => {
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

  test('works[n].key: mix of valid, invalid and missing', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210',
      works: { 'OL123456789W': ['9876543210', '8765432109'], },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editBook(book => {
        book.works.unshift({ key: 1234 });
        book.works.push({ other: 'no key here' });
        book.works.push({ key: 'blah3-invalid-key' });
      })
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    data.makeAssertions(fetcher, result);

    expect(result.editionsFaults).toHaveLength(0);
    expect(result.workFaults).toHaveLength(3);
  });
});

class Literal {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public value: any) { }
}
class Rejection {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public error: any) { }
}
function editionsURL(workId: string, offset?: number) {
  const offsetQuery = offset == null || offset == 0 ? '' : `?offset=${offset}`;
  return `https://openlibrary.org/works/${workId}/editions.json${offsetQuery}`;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function paginateEditions(pageSize: number, workId: string, editionISBNs: (string | string[])[]): { start: number, editions: any }[] {
  function* pages(size: number, total: number) {
    let start = 0;
    if (total == 0) { yield { start: 0, end: 0, last: true }; return }
    while (start < total) {
      const end = Math.min(start + size, total);
      yield { start, end, last: end >= total };
      start = end;
    }
  }
  function editionsResponse(editionISBNs: (string | string[])[], next?: { workId: string, nextStart: number }) {
    function tagged(isbns: (string | string[])[]) {
      const tag = (isbn: string) => normalizeISBN(isbn).length == 10 ? { isbn_10: [isbn] } : { isbn_13: [isbn] };
      return isbns.map(is => Array.isArray(is) ? Object.assign({}, ...is.map(tag)) : tag(is));
    }
    return {
      ...next == null
        ? {}
        : { links: { next: editionsURL(next.workId, next.nextStart) } },
      entries: tagged(editionISBNs),
    };
  }
  return Array.from(pages(pageSize, editionISBNs.length))
    .map(({ start, end, last }) => ({
      start,
      editions: editionsResponse(editionISBNs.slice(start, end), last ? undefined : { workId, nextStart: end })
    }));
}
type FetcherData = {
  isbn: string,
  pageSize?: number,
  works: Record<string, (string | string[])[]>,
};
type Book = any;      // eslint-disable-line @typescript-eslint/no-explicit-any
type Editions = any;  // eslint-disable-line @typescript-eslint/no-explicit-any
class FetcherBuilder {
  public isbn: string;
  isbnURL(): string { return isbnURL(this.isbn) }
  private book: Book;
  private originalISBNs: Set<string>;
  private workEditionsPages: Map<string, { start: number, editions: Editions }[]>;
  constructor(data: FetcherData) {
    this.isbn = data.isbn;
    this.book = {
      works: Object.keys(data.works).map(workId => ({ key: `/works/${workId}` })),
    };
    this.originalISBNs = new Set();
    this.workEditionsPages = new Map();
    Object.entries(data.works).forEach(([workId, isbns]) => {
      isbns.flat().forEach(isbn => this.originalISBNs.add(normalizeISBN(isbn)));
      const editionsPages = paginateEditions(data.pageSize ?? +Infinity, workId, isbns);
      this.workEditionsPages.set(workId, editionsPages);
    });
    Object.freeze(this.originalISBNs);
  }
  editBook(fn: (book: Book, info: { isbn: string }, replace: (newBook: Book) => void) => void) {
    const replace = (newBook: Book): void => this.book = newBook;
    fn(this.book, { isbn: this.isbn }, replace);
    return this;
  }
  editEditions(fn: (editions: Editions, info: { workId: string, pageNum: number, totalPages: number }, replace: (newEditions: Editions) => void) => void) {
    this.workEditionsPages.forEach((editionsPages, workId) => {
      editionsPages.forEach((data, index) => {
        const replace = (newEditions: Editions): void => data.editions = newEditions;
        fn(data.editions, { workId, pageNum: index + 1, totalPages: editionsPages.length }, replace);
      });
    });
    return this;
  }
  fetcher(): Fetcher {
    const map = new Map();
    map.set(isbnURL(this.isbn), this.book);
    this.workEditionsPages.forEach((editionsPages, workId) => {
      editionsPages.forEach(({ start, editions }) => {
        map.set(editionsURL(workId, start), editions);
      });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (url) => {
      if (map.has(url)) {
        const responseObj = map.get(url)!;  // eslint-disable-line @typescript-eslint/no-non-null-assertion
        if (responseObj instanceof Literal) return responseObj.value;
        if (responseObj instanceof Rejection) throw responseObj.error;
        return toJ(responseObj);
      }
      throw `Unexpected URL to fetch: ${url}!`;
    };
  }
  editionsPageURLs(): string[] {
    return Array.from(this.workEditionsPages.entries()).flatMap(([workId, editionsPages]) =>
      editionsPages.map(({ start }) =>
        editionsURL(workId, start)));
  }
  makeAssertions(fetcher: jest.Mock<Fetcher>, result?: EditionsISBNResults) {
    /* eslint-disable jest/no-standalone-expect */
    const editionsPageStarts: [string, number[]][] =
      [...this.workEditionsPages.entries()]
        .map(([workId, pageInfo]) => [workId, pageInfo.map(s => s.start)]);
    const numCalls = 1 + editionsPageStarts.reduce((count, [, starts]) => count + starts.length, 0);

    // fetcher calls
    expect(fetcher).toHaveBeenCalledTimes(numCalls);
    expect(fetcher).toHaveReturnedTimes(numCalls);
    expect(fetcher).toHaveBeenNthCalledWith(1, this.isbnURL());

    const calls = fetcher.mock.calls;
    editionsPageStarts.forEach(([workId, starts]) => {
      const callOrder = starts.map(start =>
        calls.findIndex(([fetchedURL]) =>
          fetchedURL == editionsURL(workId, start)));

      expect(callOrder).toStrictEqual(callOrder.slice().sort());
    });

    // result invariants
    if (result) {
      result.workFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
      result.editionsFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));

      if (result.isbns == null) expect(this.originalISBNs).toHaveProperty('size', 0);
      else expect(Array.from(result.isbns).sort()).toStrictEqual(Array.from(this.originalISBNs).sort());
    }
    /* eslint-enable */
  }
}

describe('editions response faults', () => {
  test('fetch fails', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', works: { 'OL123456789W': [] },
    });
    const err = 'failed to fetch editions';
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editEditions((...[, , replace]) => replace(new Rejection(err)))
      .fetcher());
    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.editionsFaults).toHaveLength(2);
    expect(result.editionsFaults[0]).toEqual(expect.objectContaining({ description: err }));

    data.makeAssertions(fetcher, result);
  });

  test('not JSON', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', works: { 'OL123456789W': [] },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editEditions((...[, , replace]) => replace(new Literal('just plain text, not JSON')))
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.editionsFaults).toHaveLength(2);

    data.makeAssertions(fetcher, result);
  });

  test('not an object', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', works: { 'OL123456789W': [] },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editEditions((editions, info, replace) => replace(123))
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.editionsFaults).toHaveLength(2);

    data.makeAssertions(fetcher);
  });

  test('missing .entries', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', works: { 'OL123456789W': [] },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editEditions((editions, info, replace) => replace({ count: 1 }))
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.editionsFaults).toHaveLength(2);

    data.makeAssertions(fetcher);
  });

  test('.entries is empty', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', works: { 'OL123456789W': [] },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data.fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.editionsFaults).toHaveLength(1);

    data.makeAssertions(fetcher);
  });

  test('.entries[0]: (only one) invalid', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', works: { 'OL123456789W': [] },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editEditions((editions) => editions.entries = [{ no_isbn: true }])
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.editionsFaults).toHaveLength(2);

    data.makeAssertions(fetcher);
  });

  test('.entries[n]: multiple without .isbn_10 or .isbn_13', async () => {
    const data = new FetcherBuilder(
      { isbn: '9876543210', works: { 'OL123456789W': [] }, }
    );
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editEditions(editions => editions.entries = [{ no_isbn: true }, { isbn_14: '!', isbn_12: '?' }, {}])
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    data.makeAssertions(fetcher, result);

    expect(result.isbns).toBeUndefined();
    expect(result.workFaults).toHaveLength(0);
    expect(result.editionsFaults).toHaveLength(4);
  });
});

describe('editions with next links', () => {
  test('one editions: three pages', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210',
      pageSize: 2,
      works: {
        'OL123456789W': [
          '9876543210', ['7654321098', '8765432109876'],
          ['5432109865432', '4321098765'], '6543210987654',
          '3210987654'
        ],
      },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data.fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    data.makeAssertions(fetcher, result);

    expect(result.workFaults).toHaveLength(0);
    expect(result.editionsFaults).toHaveLength(0);
  });

  test('two works, one page and three pages of editions', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210',
      pageSize: 3,
      works: {
        'OL123456789W': [
          '9876543210', ['7654321098', '8765432109876'], '6543210987',
        ],
        'OL234567891W': [
          '5432109876543', [], ['4321098765', '3210987654321'],
          '2109876543', '1098765432109', [],
          [], '9987654321',
        ],
      },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data.fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    data.makeAssertions(fetcher, result);

    expect(result.workFaults).toHaveLength(0);
    expect(result.editionsFaults).toHaveLength(3);
  });
});

describe('full isbn & editions tests', () => {
  test('multiple works, some invalid, multiple editions, some invalid', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210',
      works: {
        'OL123456789W': ['9876543210', [], '8765432109876', ['7654321098', '6543210987654']],
        'OL234567890W': [[], '5432109876', ['4321098765432', '3210987654']],
      },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editBook(book => book.works.push('/work/invalid'))
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    data.makeAssertions(fetcher, result);

    expect(result.workFaults).toHaveLength(1);
    expect(result.editionsFaults).toHaveLength(2);
  });

  test('missing .entries in 2nd of 3 editions pages', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210',
      pageSize: 2,
      works: {
        'OL123456789W': [
          '9876543210', [],
          [], [], // .entries to be deleted
          '8765432109876', ['7654321098', '6543210987654'],
        ],
      },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editEditions((editions, info) => { if (info.pageNum == 2) delete editions.entries; })
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    data.makeAssertions(fetcher, result);

    expect(result.workFaults).toHaveLength(0);
    expect(result.editionsFaults).toHaveLength(2);
  });

  test('duplicate works, editions fetched only once', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210',
      works: {
        'OL123456789W': ['9876543210', [], '8765432109876', ['7654321098', '6543210987654']],
      },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editBook(book => book.works.push(book.works[0]))
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    data.makeAssertions(fetcher, result);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.workFaults).toHaveLength(0);
    expect(result.editionsFaults).toHaveLength(1);
  });

  test('duplicate ISBNs across works or intra-editions', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210',
      works: {
        'OL123456789W': ['9876543210', '8765432109876', ['9876543210', '7654321098765']],
        'OL234567890W': ['6543210987', ['8765432109876']],
      },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data.fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    data.makeAssertions(fetcher, result);

    expect(result.isbns).toHaveProperty('size', 4);
    expect(result.workFaults).toHaveLength(0);
    expect(result.editionsFaults).toHaveLength(0);
  });

  test('ISBNs are normalized (no spaces, hyphens, uppercase)', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210',
      works: {
        'OL123456789W': ['987-654-321-0', '876-54-32-10987-6', ['765-43210-98-76-5']],
        'OL234567890W': ['65 432-1098 7', ['543 210 98-7654 3', '4 321-09876-x']],
      },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data.fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    data.makeAssertions(fetcher, result);

    expect(result.isbns?.has('432109876X')).toBeTruthy();
    expect(result.workFaults).toHaveLength(0);
    expect(result.editionsFaults).toHaveLength(0);
  });

  test('real (saved) data', async () => {
    const furl = (file: string) => {
      if (__dirname)
        return join(__dirname, file);
      else
        return new URL(file, import.meta.url);
    };
    const isbnResponse = await readFile(furl('isbn.json'), 'utf-8');
    const editionsResponse = await readFile(furl('editions.json'), 'utf-8');

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(isbnResponse)
      .mockResolvedValueOnce(editionsResponse);

    const isbn = '0-7653-9276-3';
    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveReturnedTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveBeenNthCalledWith(2, editionsURL('OL17801248W'));

    expect(result.workFaults).toHaveLength(0);
    expect(result.editionsFaults).toHaveLength(0);

    result.workFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
    result.editionsFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));

    expect(result.isbns).toBeDefined();

    if (!result.isbns) throw 'isbns missing from result'; // let TS know isbns is not undefined

    expect(Array.from(result.isbns)).toStrictEqual(['153842424X',
      '9781538424247',
      '9781786693044',
      '1786693070',
      '9781786693075',
      '0765392763',
      '9780765392763',
      '0765392771',
      '9780765392770',
      '1786693062',
      '9781786693068',
      '1786693054',
      '9781786693051',
      '9780765392787']);
  });
});

describe('validateISBN', () => {
  test.each([
    '0765392763',
    '0-7653 9276-3',
    '0765392771',
    '0 7653-9277 1',
    '153842424X',
    '1-5384-2424-X',
    '9780765392763',
    '978-0-7653-9276-3',
    '9780765392770',
    '978-0 7653-9277 0',
    '9781538424247',
    '978-1-5384 2424-7',
    '9791000000008',
    '979 1 0000 0000 8',
  ])('true for valid ISBNs', isbn => {
    expect(validateISBN(isbn)).not.toBeFalsy();
  });

  test.each([
    '0765392760',
    '0765392761',
    '0765392762',
    '0765392764',
    '0765392765',
    '0765392766',
    '0765392767',
    '0765392768',
    '0765392769',
    '076539276X',
    '9780765392760',
    '9780765392761',
    '9780765392762',
    '9780765392764',
    '9780765392765',
    '9780765392766',
    '9780765392767',
    '9780765392768',
    '9780765392769',
    'NotAnISBN',
    'not an isbn',
    '1234567890',
    '1234567890123',
  ])('false for ISBNs with bad check digits', isbn => {
    expect(validateISBN(isbn)).toBeFalsy();
  });
});

describe('equivalentISBNs', () => {
  test.each([
    ['not an\t isbn', 'NOTANISBN'],
    ['12-345\r6789-0', '1234567890'],
    ['123-45-678\n 9012 3', '1234567890123'],
  ])('just normalizes invalid ISBNs', (notISBN, normal) => {
    expect(equivalentISBNs(notISBN)).toStrictEqual([normal]);
  });

  test.each([
    ['0765392763', '9780765392763'],
    ['0765392771', '9780765392770'],
    ['153842424X', '9781538424247'],
  ])('valid ISBN-10: also yields ISBN-13', (isbn10, isbn13) => {
    const result = equivalentISBNs(isbn10);

    expect(isbn10).toHaveLength(10);
    expect(isbn13).toHaveLength(13);
    expect(result).toHaveLength(2);
    expect(result).toContain(isbn10);
    expect(result).toContain(isbn13);
  });

  test.each([
    ['9780765392763', '0765392763'],
    ['9780765392770', '0765392771'],
    ['9781538424247', '153842424X'],
  ])('valid 978 ISBN-13: also yields ISBN-10', (isbn13, isbn10) => {
    const result = equivalentISBNs(isbn13);

    expect(isbn10).toHaveLength(10);
    expect(isbn13).toHaveLength(13);
    expect(result).toHaveLength(2);
    expect(result).toContain(isbn13);
    expect(result).toContain(isbn10);
  });

  test.each([
    ['0 7653-9276 3', '978 0-7653 9276-3'],
    ['0-7653 9277-1', '978-0 7653-9277 0'],
    ['1 5384 2424-X', '978-1-5384 2424 7'],
  ])('hyphens and spaces are disregarded and not returned', (isbn10, isbn13) => {
    const result10 = equivalentISBNs(isbn10);
    const result13 = equivalentISBNs(isbn13);

    const bare10 = normalizeISBN(isbn10);
    const bare13 = normalizeISBN(isbn13);

    expect(bare10).toHaveLength(10);
    expect(bare13).toHaveLength(13);
    expect(result10).toHaveLength(2);
    expect(result10).toContain(bare10);
    expect(result10).toContain(bare13);
    expect(result13).toHaveLength(2);
    expect(result13).toContain(bare10);
    expect(result13).toContain(bare13);
  });

  test.each([
    '9791000000008',
    '979-10 00-00000 8',
  ])('valid 979 ISBN-13: yields nothing extra', untenable => {
    const result = equivalentISBNs(untenable);
    const bare = normalizeISBN(untenable);

    expect(bare).toHaveLength(13);
    expect(result).toHaveLength(1);
    expect(result).toContain(bare);
  });
});
