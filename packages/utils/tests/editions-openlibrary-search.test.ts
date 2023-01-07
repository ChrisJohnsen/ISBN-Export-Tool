import { describe, test, expect, jest } from '@jest/globals';
import {
  normalizeISBN,
  type Fetcher, ContentError, EditionsISBNResults,
  otherEditionsOfISBN__OpenLibrary_Search as otherEditionsOfISBN,
} from 'utils';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

function searchURL(isbn: string) {
  return `https://openlibrary.org/search.json?q=${isbn}&fields=isbn`;
}

class Literal {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public value: any) { }
}
class Rejection {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public error: any) { }
}
type FetcherData = {
  isbn: string,
  isbns: string[][]
};
type Search = any; // eslint-disable-line @typescript-eslint/no-explicit-any
class FetcherBuilder {
  public isbn: string;
  private originalISBNs: Set<string>;
  public search: Search;
  constructor(data: FetcherData) {
    this.isbn = data.isbn;
    this.originalISBNs = new Set(data.isbns.flat().map(normalizeISBN));
    this.search = {
      numFound: 1,
      start: 0,
      numFoundExact: true,
      docs: data.isbns.map(isbns => ({ isbn: isbns })),
      num_found: 1,
      q: data.isbn,
      offset: null
    };
    Object.freeze(this.originalISBNs);
  }
  searchURL() { return searchURL(this.isbn) }
  editSearch(fn: (search: Search, info: { isbn: string }, replace: (newSearch: Search) => void) => void) {
    const replace = (newSearch: Search): void => this.search = newSearch;
    fn(this.search, { isbn: this.isbn }, replace);
    return this;
  }
  fetcher(): Fetcher {
    return async (url: string) => {
      if (url == searchURL(this.isbn)) {
        const responseObj = this.search;
        if (responseObj instanceof Literal) return responseObj.value;
        if (responseObj instanceof Rejection) throw responseObj.error;
        return JSON.stringify(responseObj);
      }
      throw `Unexpected URL to fetch: ${url}!`;
    };
  }
  makeAssertions(fetcher: jest.Mock<Fetcher>, result?: EditionsISBNResults) {
    /* eslint-disable jest/no-standalone-expect */

    // fetcher calls
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveReturnedTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, this.searchURL());

    // result invariants
    if (result) {
      result.warnings.forEach(f => expect(f).toBeInstanceOf(ContentError));
      result.temporaryFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));

      expect(result.isbns).toBeInstanceOf(Set);
      expect(Array.from(result.isbns).sort()).toStrictEqual(Array.from(this.originalISBNs).sort());
    }
    /* eslint-enable */
  }
}

describe('search response faults', () => {
  test('fetch fails', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', isbns: [],
    });
    const err = 'failed to fetch search';
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editSearch((...[, , replace]) => replace(new Rejection(err)))
      .fetcher());

    await expect(() => otherEditionsOfISBN(fetcher, data.isbn)).rejects.toBe(err);

    data.makeAssertions(fetcher);
  });

  test('not JSON', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', isbns: [],
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editSearch((...[, , replace]) => replace(new Literal('just plain text, not JSON')))
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(2);

    data.makeAssertions(fetcher, result);
  });

  test('not an object', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', isbns: [],
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editSearch((...[, , replace]) => replace(123))
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(2);

    data.makeAssertions(fetcher, result);
  });

  test('missing .docs', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', isbns: [],
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editSearch((...[, , replace]) => replace({ count: 1 }))
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(2);

    data.makeAssertions(fetcher, result);
  });

  test('.docs is empty', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', isbns: [],
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editSearch(search => search.docs = [])
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(1);

    data.makeAssertions(fetcher, result);
  });

  test('.docs[0]: (only one) missing .isbn', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', isbns: [],
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editSearch(search => search.docs = [{ no_isbn: true }])
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(1);
    expect(result.temporaryFaults).toHaveLength(1);

    data.makeAssertions(fetcher, result);
  });

  test('.docs[n]: multiple without .isbn', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', isbns: [],
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editSearch(search => search.docs = [{ no_isbn: true }, { also_no_isbn: '!' }, {}])
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(3);
    expect(result.temporaryFaults).toHaveLength(1);

    data.makeAssertions(fetcher, result);
  });

  test('.docs[n].isbn is empty', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', isbns: [],
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data.fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(1);

    data.makeAssertions(fetcher, result);
  });
});

describe('full search tests', () => {
  test('multiple docs, some invalid, multiple isbns, some invalid', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210',
      isbns: [['9876543210', '8765432109876', '7654321098'], ['6543210987654', '5432109876', '4321098765432', '3210987654']],
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .editSearch(search => {
        search.docs.push({ no_isbn: 'here' });
        search.docs[0].isbn.splice(1, 0, 1234);
        search.docs[1].isbn.splice(2, 0, 5678);
      }).fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    data.makeAssertions(fetcher, result);

    expect(result.warnings).toHaveLength(3);
    expect(result.temporaryFaults).toHaveLength(0);
  });

  test('duplicate ISBNs intra-doc and across docs', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210',
      isbns: [
        ['9876543210', '8765432109876', '9876543210', '7654321098765'],
        ['6543210987', '8765432109876'],
      ],
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
      isbns: [
        ['987-654-321-0', '876-54-32-10987-6', '765-43210-98-76-5'],
        ['65 432-1098 7', '543 210 98-7654 3', '4 321-09876-x'],
      ],
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
    const search = await readFile(furl('openlibrary-search.json'), 'utf-8');

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(search);

    const isbn = '0-7653-9276-3';
    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveReturnedTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, searchURL(isbn));

    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(0);

    result.warnings.forEach(f => expect(f).toBeInstanceOf(ContentError));
    result.temporaryFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));

    expect(result.isbns).toBeInstanceOf(Set);

    expect(Array.from(result.isbns)).toStrictEqual([
      "9781786693051",
      "1786693054",
      "9781786693068",
      "9781786693044",
      "1786693070",
      "9780765392770",
      "1786693046",
      "9781538424247",
      "9780765392787",
      "9780765392763",
      "076539278X",
      "0765392763",
      "9781786693075",
      "153842424X",
      "0765392771",
      "1786693062"
    ]);
  });
});
