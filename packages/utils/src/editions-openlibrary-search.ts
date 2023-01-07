import { Fetcher, EditionsISBNResults, ContentError } from './editions-common.js';
import { InitialFault, fetcherResponseOrFault } from "./editions-internal.js";
import * as t from 'typanion';
import { normalizeISBN } from './isbn.js';

// Parse Open Library resources to find ISBNs of other editions of given ISBN.
//
// This variation is a single-step process:
// 1. /search.json?q=<isbn>&fields=isbn
//   - collect docs[n].isbn[n]

const OlUrlPrefix = 'https://openlibrary.org';

/**
 * Fetch from Open Library (openlibrary.org) the ISBNs of all editions of the
 * given ISBN.
 *
 * This implementation makes a single request of Open Library:
 * 1. just exactly the data we want: the ISBNs of other editions of the given
 *    ISBN.
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

    const isbns = await searchISBNsOfISBN(fetch, isbn);

    if (isbns.set.size < 1) {

      const newFault = new ContentError(`no valid ISBNs in search results for ${isbn}`);

      return isbns.addTemporaryFault(newFault).asEditionsISBNResults();

    }
    return isbns.asEditionsISBNResults(true);
  }
}

class StringsAndFaults {
  set: Set<string> = new Set;
  warnings: ContentError[] = [];
  temporaryFaults: ContentError[] = [];
  constructor(fault?: InitialFault<string | ContentError>) {
    if (!fault) return;
    if ('warning' in fault) this.addWarning(fault.warning);
    if ('temporary' in fault) this.addTemporaryFault(fault.temporary);
  }
  addString(datum: string) {
    this.set.add(datum);
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private addError(err: any, arr: ContentError[]) {
    const fault = err instanceof ContentError ? err : new ContentError(err.toString());
    arr.push(fault);
    return this;
  }
  asEditionsISBNResults(withISBNs?: boolean): EditionsISBNResults {
    const { warnings, temporaryFaults } = this;
    const isbns = withISBNs ? this.set : new Set<string>;
    return { isbns, warnings, temporaryFaults };
  }
  absorbFaults(other: StringsAndFaults) {
    this.warnings = this.warnings.concat(other.warnings);
    this.temporaryFaults = this.temporaryFaults.concat(other.temporaryFaults);
    return this;
  }
  addWarning(fault: string | ContentError) {
    return this.addError(fault, this.warnings);
  }
  addTemporaryFault(fault: string | ContentError) {
    return this.addError(fault, this.temporaryFaults);
  }
}

class EditionsResult extends StringsAndFaults {
  absorb(other: EditionsResult) {
    other.set.forEach(datum => this.set.add(datum));
    this.absorbFaults(other);
    return this;
  }
}

async function searchISBNsOfISBN(fetch: Fetcher, isbn: string): Promise<EditionsResult> {

  const urlTail = `/search.json?q=${isbn}&fields=isbn`;

  const url = `${OlUrlPrefix}${urlTail}`;

  const response = fetcherResponseOrFault(urlTail, await fetch(url));

  if (typeof response != 'string') return new EditionsResult(response);

  // parse JSON
  let json;
  try {
    json = JSON.parse(response);
  } catch {
    return new EditionsResult({ temporary: `${urlTail} response is not parseable as JSON` });
  }

  const result = new EditionsResult;

  // has .docs[n]?
  const hasDocs = t.isPartial({ docs: t.isArray(t.isUnknown()) });
  const validation = t.as(json, hasDocs, { errors: true });
  if (validation.errors)
    return result.addTemporaryFault(`${urlTail} malformed?: ${validation.errors.join('; ')}`);
  const editions = validation.value;

  // collect ISBNs from .docs[n].isbn[n]
  return editions.docs.reduce(
    (result: EditionsResult, unknownDoc, index) => {

      // .docs[n] has .isbn_{10,13}[n]?
      const validation = t.as(unknownDoc, t.isPartial({
        isbn: t.isArray(t.isUnknown()),
      }), { errors: true });
      if (validation.errors)
        return result.addWarning(`${urlTail} .docs[${index}] malformed?: ${validation.errors.join('; ')}`);
      const doc = validation.value;

      const entryResult = new EditionsResult;

      doc.isbn.forEach((isbn, isbnIndex) => {
        if (t.isString()(isbn))
          entryResult.addString(normalizeISBN(isbn));
        else
          entryResult.addWarning(`${urlTail} .docs[${index}].isbn[${isbnIndex}] is not a string`);
      });

      if (entryResult.set.size < 1)
        entryResult.addWarning(`${urlTail} .docs[${index}] has no ISBNs`);

      return result.absorb(entryResult);
    },
    result);
}
