import { describe, test, expect, jest } from '@jest/globals';
import {
  normalizeISBN,
  type Fetcher, ContentError, EditionsISBNResults,
  otherEditionsOfISBN__LibraryThing_ThingISBN as otherEditionsOfISBN,
} from 'utils';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

function thingISBNURL(isbn: string) {
  return `https://www.librarything.com/api/thingISBN/${isbn}`;
}

function tag(tagName: string, inner?: string): string {
  return `<${tagName}>${inner ?? ''}</${tagName}>`;
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
  isbns: string[]
};
type Xml = any; // eslint-disable-line @typescript-eslint/no-explicit-any
class FetcherBuilder {
  public isbn: string;
  private originalISBNs: Set<string>;
  public xml: Xml;
  constructor(data: FetcherData) {
    this.isbn = data.isbn;
    this.originalISBNs = new Set(data.isbns.map(normalizeISBN));
    this.xml = tag('idlist', data.isbns.map(isbn => tag('isbn', isbn)).join(''));
    Object.freeze(this.originalISBNs);
  }
  thisISBNURL() { return thingISBNURL(this.isbn) }
  replaceXML(newXML: Xml) {
    this.xml = newXML;
    return this;
  }
  fetcher(): Fetcher {
    return async (url: string) => {
      if (url == thingISBNURL(this.isbn)) {
        const responseObj = this.xml;
        if (responseObj instanceof Literal) return responseObj.value;
        if (responseObj instanceof Rejection) throw responseObj.error;
        return responseObj;
      }
      throw `Unexpected URL to fetch: ${url}!`;
    };
  }
  makeAssertions(fetcher: jest.Mock<Fetcher>, result?: EditionsISBNResults) {
    /* eslint-disable jest/no-standalone-expect */

    // fetcher calls
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveReturnedTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, this.thisISBNURL());

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
      .replaceXML(new Rejection(err))
      .fetcher());

    await expect(() => otherEditionsOfISBN(fetcher, data.isbn)).rejects.toBe(err);

    data.makeAssertions(fetcher);
  });

  test('not XML', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', isbns: [],
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .replaceXML('just plain text, not XML')
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(1);

    data.makeAssertions(fetcher, result);
  });

  test('root not idlist', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', isbns: [],
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .replaceXML(tag('foo'))
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(1);

    data.makeAssertions(fetcher, result);
  });

  test('idlist is empty', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', isbns: [],
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .replaceXML(tag('idlist'))
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(1);

    data.makeAssertions(fetcher, result);
  });

  test('idlist has no isbn', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210', isbns: [],
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .replaceXML(tag('idlist', tag('bar') + tag('baz')))
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    expect(result.isbns).toHaveProperty('size', 0);
    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(1);

    data.makeAssertions(fetcher, result);
  });
});

describe('full ThingISBN tests', () => {
  test('multiple ISBNs, some empty', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210',
      isbns: ['9876543210', '8765432109876', '7654321098', '6543210987654'],
    });
    const fetcher = jest.fn<Fetcher>().mockImplementation(data
      .replaceXML((data.xml as string)
        .replace(/<\/isbn>/, '$&' + tag('isbn'))                // empty after first
        .replace(/(.*<\/isbn>)(<isbn>)/, `$1${tag('isbn')}$2`)) // empty before last
      .fetcher());

    const result = await otherEditionsOfISBN(fetcher, data.isbn);

    data.makeAssertions(fetcher, result);

    expect(result.warnings).toHaveLength(2);
    expect(result.temporaryFaults).toHaveLength(0);
  });

  test('duplicate ISBNs', async () => {
    const data = new FetcherBuilder({
      isbn: '9876543210',
      isbns: ['9876543210', '8765432109876', '9876543210', '7654321098765', '6543210987', '8765432109876'],
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
      isbns: ['987-654-321-0', '876-54-32-10987-6', '4 321-09876-x'],
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
      if (typeof __dirname == 'string')
        return join(__dirname, file);
      else
        return new URL(file, import.meta.url);
    };
    const search = await readFile(furl('thing-editions.xml'), 'utf-8');

    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(search);

    const isbn = '0-7653-9276-3';
    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveReturnedTimes(1);
    expect(fetcher).toHaveBeenNthCalledWith(1, thingISBNURL(isbn));

    expect(result.warnings).toHaveLength(0);
    expect(result.temporaryFaults).toHaveLength(0);

    result.warnings.forEach(f => expect(f).toBeInstanceOf(ContentError));
    result.temporaryFaults.forEach(f => expect(f).toBeInstanceOf(ContentError));

    expect(result.isbns).toBeInstanceOf(Set);

    expect(Array.from(result.isbns)).toStrictEqual([
      '0765392763',
      '0765392771',
      '076539278X',
      '1786693070',
      '1786693054',
      '1786693062',
      '1786693046',
      '0765394170',
      '153842424X',
      '3453317939',
      '3641195799',
      '1538424290',
      '1538424282',
      '151007824X',
      '1538424258',
      '1982412623',
      '1538424231',
      '9780765392787',
      '9781538424285',
    ]);
  });
});
