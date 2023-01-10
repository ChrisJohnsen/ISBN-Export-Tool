import { Fetcher, EditionsISBNResults, ContentError } from './editions-common.js';
import { fetcherResponseOrFault, EditionsResult } from "./editions-internal.js";
import { normalizeISBN } from './isbn.js';

// Parse LibraryThing ThingISBN response to find ISBNs of other editions of given ISBN.
//
// https://www.librarything.com/api/thingISBN/<isbn>

const TIUrlPrefix = 'https://www.librarything.com';

/**
 * Fetch from LibraryThing (librarything.com) the ISBNs of all editions of the
 * given ISBN.
 *
 * The result ISBNs are not validated (e.g. with validateISBN), but they are
 * de-duplicated since they are returned in a Set<string>.
 *
 * Errors are reported in two properties:
 * - `temporaryFaults` for problems fetching or parsing the data, and
 * - `warnings` for small glitches that did not impede overall progress.
 */
export function otherEditionsOfISBN(fetch: Fetcher, isbn: string): Promise<EditionsISBNResults>;
export function otherEditionsOfISBN(fetch: Fetcher): (isbn: string) => Promise<EditionsISBNResults>;
export function otherEditionsOfISBN(fetch: Fetcher, isbn?: string): Promise<EditionsISBNResults> | ((isbn: string) => Promise<EditionsISBNResults>) {

  if (isbn === undefined) {
    return otherEditionsOf_ISBN;
  } else {
    return otherEditionsOf_ISBN(isbn);
  }

  async function otherEditionsOf_ISBN(isbn: string): Promise<EditionsISBNResults> {

    const isbns = await thingISBNsOfISBN(fetch, isbn);

    if (isbns.set.size < 1) {

      const newFault = new ContentError(`no valid ISBNs in search results for ${isbn}`);

      return isbns.addTemporaryFault(newFault).asEditionsISBNResults();

    }
    return isbns.asEditionsISBNResults(true);
  }
}

async function thingISBNsOfISBN(fetch: Fetcher, isbn: string): Promise<EditionsResult> {

  const urlTail = `/api/thingISBN/${isbn}`;

  const url = `${TIUrlPrefix}${urlTail}`;

  const response = fetcherResponseOrFault(urlTail, await fetch(url));

  if (typeof response != 'string') return new EditionsResult(response);

  // the XML looks like <?xml ...><idlist><isbn>1234</isbn>...more isbn elements...</idlist>
  // extract the ISBNs with a simple matchAll
  return Array.from(response.matchAll(/<isbn>([^<]*)<\/isbn>/g))
    .map(match => match[1])
    // process the matches into EditionsResult
    .reduce((result, rawISBN) => {
      const isbn = normalizeISBN(rawISBN);
      if (isbn.length == 0)
        return result.addWarning(`${urlTail} empty <isbn>`);
      return result.addString(isbn);
    }, new EditionsResult);
}
