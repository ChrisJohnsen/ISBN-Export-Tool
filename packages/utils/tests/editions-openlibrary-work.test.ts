import { describe, test, expect, jest } from '@jest/globals';
import {
  normalizeISBN,
  type Fetcher, ContentError, EditionsISBNResults,
  otherEditionsOfISBN__OpenLibrary_WorkEditions as otherEditionsOfISBN,
} from 'utils';
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

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);

    result.temporaryFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
  });

  test('not object', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ(1));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);

    result.temporaryFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
  });

  test('missing .works', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ({}));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);

    result.temporaryFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
  });

  test('.works is empty', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ({ works: [] }));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);

    result.temporaryFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
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
    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(3);
    expect(result.temporaryFaults).toHaveLength(1);

    result.warnings.forEach(f => expect(f).toBeInstanceOf(ContentError));
    result.temporaryFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
  });

  test('works[0].key (only one) invalid', async () => {
    const isbn = '9876543210';

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(toJ({ works: [{ key: 'blah1' },] }));

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(1);
    expect(result.temporaryFaults).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveReturnedTimes(1);

    result.warnings.forEach(f => expect(f).toBeInstanceOf(ContentError));
    result.temporaryFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
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
    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(3);
    expect(result.temporaryFaults).toHaveLength(1);

    result.warnings.forEach(f => expect(f).toBeInstanceOf(ContentError));
    result.temporaryFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));
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

    expect(result.warnings).toHaveLength(3);
    expect(result.temporaryFaults).toHaveLength(0);

    result.warnings.forEach(f => expect(f).toBeInstanceOf(ContentError));
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
      result.warnings.forEach(f => expect(f).toBeInstanceOf(ContentError));
      result.temporaryFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));

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

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(2);
    expect(result.temporaryFaults[0]).toEqual(expect.objectContaining({ description: err }));

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

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(2);

    data.makeAssertions(fetcher, result);
  });

  test('not an object', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', works: { 'OL123456789W': [] },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editEditions((...[, , replace]) => replace(123))
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(2);

    data.makeAssertions(fetcher, result);
  });

  test('missing .entries', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', works: { 'OL123456789W': [] },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editEditions((...[, , replace]) => replace({ count: 1 }))
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(2);

    data.makeAssertions(fetcher, result);
  });

  test('.entries is empty', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', works: { 'OL123456789W': [] },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data.fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(1);

    data.makeAssertions(fetcher, result);
  });

  test('.entries[0]: (only one) invalid', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', works: { 'OL123456789W': [] },
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editEditions(editions => editions.entries = [{ no_isbn: true }])
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(1);
    expect(result.temporaryFaults).toHaveLength(1);

    data.makeAssertions(fetcher, result);
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

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(3);
    expect(result.temporaryFaults).toHaveLength(1);
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

    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(0);
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

    expect(result.warnings).toHaveLength(3);
    expect(result.temporaryFaults).toHaveLength(0);
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

    expect(result.warnings).toHaveLength(3);
    expect(result.temporaryFaults).toHaveLength(0);
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

    expect(result.warnings).toHaveLength(1);
    expect(result.temporaryFaults).toHaveLength(1);
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
    expect(result.warnings).toHaveLength(1);
    expect(result.temporaryFaults).toHaveLength(0);
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
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(0);
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
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(0);
  });

  test('real (saved) data', async () => {
    const furl = (file: string) => {
      if (__dirname)
        return join(__dirname, file);
      else
        return new URL(file, import.meta.url);
    };
    const isbnResponse = await readFile(furl('openlibrary-isbn.json'), 'utf-8');
    const editionsResponse = await readFile(furl('openlibrary-editions.json'), 'utf-8');

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(isbnResponse)
      .mockResolvedValueOnce(editionsResponse);

    const isbn = '0-7653-9276-3';
    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveReturnedTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL(isbn));
    expect(fetcher).toHaveBeenNthCalledWith(2, editionsURL('OL17801248W'));

    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(0);

    result.warnings.forEach(f => expect(f).toBeInstanceOf(ContentError));
    result.temporaryFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));

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
