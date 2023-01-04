// parse Open Library resources to find ISBNs of other editions of given ISBN

const OlUrlPrefix = 'https://openlibrary.org';

export type Fetcher = (url: string) => Promise<string>;

export class ContentError {
  constructor(public description: string) { }
}

export interface EditionsISBNResults {
  isbns?: Set<string>,
  warnings: ContentError[],
  temporaryFaults: ContentError[],
}

/**
 * Fetch from Open Library (openlibrary.org) the ISBNs of all editions of the
 * given ISBN.
 *
 * This implementation makes multiple requests of Open Library:
 * 1. data about the ISBN, so we can find the Open Library work identifier
 * 2. data about the editions of the work (this may be multiple requests since
 *    the data can be paginated).
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

    const workIDs = await getWorkIDsForISBN(fetch, isbn);

    if (workIDs.set.size < 1) return workIDs.asEditionsISBNResults();

    const isbns =
      (await Promise.allSettled(Array.from(workIDs.set).map(
        async workID => processAllEditionsPages(fetch, editionsURL(workID)))))
        .reduce(absorbSettledResult, new EditionsResult);

    isbns.absorbFaults(workIDs); // XXX this puts workID faults last...

    if (isbns.set.size < 1) {

      const newFault = new ContentError(`no valid ISBNs among all editions.jsons for all ${isbn} works`);

      return isbns.addTemporaryFault(newFault).asEditionsISBNResults();

    }
    return isbns.asEditionsISBNResults(true);

    function editionsURL(workID: string) {
      return `${OlUrlPrefix}/works/${workID}/editions.json`;
    }

    function absorbSettledResult(result: EditionsResult, settled: PromiseSettledResult<EditionsResult>) {
      if (settled.status == 'fulfilled')
        return result.absorb(settled.value);
      else
        return result.addTemporaryFault(settled.reason.toString());
    }
  }
}

import * as t from 'typanion';

class StringsAndFaults {
  set: Set<string> = new Set;
  warnings: ContentError[] = [];
  temporaryFaults: ContentError[] = [];
  constructor(fault?: string | ContentError) {
    fault && this.addTemporaryFault(fault);
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
    const result = { isbns: this.set, warnings, temporaryFaults } as EditionsISBNResults;
    if (!withISBNs) delete result.isbns;
    return result;
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

async function getWorkIDsForISBN(fetch: Fetcher, isbn: string): Promise<StringsAndFaults> {

  const urlTail = `/isbn/${isbn}.json`;

  const response = await fetch(`${OlUrlPrefix}${urlTail}`);

  let json;
  try {
    json = JSON.parse(response);
  } catch {
    return new StringsAndFaults(`${urlTail} response is not parseable as JSON`);
  }

  // .works is an array?
  const hasWorksArray = t.isPartial({ works: t.isArray(t.isUnknown()) });
  const validation = t.as(json, hasWorksArray, { errors: true });
  if (validation.errors)
    return new StringsAndFaults(`${urlTail} malformed?: ${validation.errors.join('; ')}`);
  const edition = validation.value;

  if (edition.works.length < 1)
    return new StringsAndFaults(`${urlTail} response .works is empty`);

  // collect workIDs from .works[n].key
  const result = edition.works.reduce(
    (result: StringsAndFaults, workObj, index) => {

      // .works[n].key is a string?
      const hasKey = t.isPartial({ key: t.isString() });
      const validation = t.as(workObj, hasKey, { errors: true });
      if (validation.errors)
        return result.addWarning(`${urlTail}.works[${index}] malformed?: ${validation.errors.join('; ')}`);
      const workKey: string = validation.value.key;

      // workID has /works/ prefix?
      const prefix = '/works/';
      if (!workKey.startsWith(prefix))
        return result.addWarning(`${urlTail} response .works[${index}].key (${workKey}) does not start with ${prefix}`);

      // strip /works/ prefix
      return result.addString(workKey.slice(prefix.length));
    },
    new StringsAndFaults);

  if (result.set.size < 1)
    return result.addTemporaryFault(`${urlTail} has no valid workIDs`);

  return result;
}

class EditionsResult extends StringsAndFaults {
  next?: string;
  setNext(next: string) {
    this.next = next;
  }
  absorb(other: EditionsResult) {
    other.set.forEach(datum => this.set.add(datum));
    this.absorbFaults(other);
    return this;
  }
}

async function processAllEditionsPages(fetch: Fetcher, url: string): Promise<EditionsResult> {

  return processEditionsURL(fetch, url).then(

    results => results.next

      ? processAllEditionsPages(fetch, results.next)

        .then(
          nextResults => results.absorb(nextResults),
          err => results.addTemporaryFault(err.toString())
        )

      : results,

    err => { throw err }); // XXX? EditionsResult.t(err.toString())
}

async function processEditionsURL(fetch: Fetcher, url: string): Promise<EditionsResult> {

  const response = await fetch(url);

  const urlTail = url.startsWith(OlUrlPrefix) ? url.slice(OlUrlPrefix.length) : url;

  // parse JSON
  let json;
  try {
    json = JSON.parse(response);
  } catch {
    return new EditionsResult(`${urlTail} response is not parseable as JSON`);
  }

  const result = new EditionsResult;

  // if there is a next page (.links.next) capture it right away
  if (t.isPartial({ links: t.isPartial({ next: t.isString() }) })(json))
    result.next = json.links.next;

  // has .entries[n].isbn_{10,13}[n]?
  const isEditions = t.isPartial({
    entries: t.isArray(t.isPartial({
      isbn_10: t.isOptional(t.isArray(t.isString())),
      isbn_13: t.isOptional(t.isArray(t.isString())),
    })),
  });
  const validation = t.as(json, isEditions, { errors: true });
  if (validation.errors)
    return result.addTemporaryFault(`${urlTail} malformed?: ${validation.errors.join('; ')}`);
  const editions = validation.value;

  // collect ISBNs from .entries[n].isbn_{10,13}[n]
  return editions.entries.reduce(
    (result: EditionsResult, entry, index) => {

      const entryResult = new EditionsResult;

      [...entry.isbn_10 ?? [], ...entry.isbn_13 ?? []]
        .forEach(isbn => entryResult.addString(normalizeISBN(isbn)));

      if (entryResult.set.size < 1)
        entryResult.addWarning(`${urlTail} .entries[${index}] has no ISBNs`);

      return result.absorb(entryResult);
    },
    result);
}

// ISBN validation and conversion

/// <reference path='./isbn3.d.ts'/>
import { parse } from 'isbn3';

/**
 * Strip spaces and hyphens, and convert to uppercase. Does not check for
 * validity.
 */
export function normalizeISBN(isbnish: string): string {
  return isbnish.replace(/\s|-/g, '').toUpperCase();
}

/**
 * Returns true if the given string is a valid ISBN.
 *
 * In addition to verifying the check digit, this will also verify whether the
 * ISBN is a part of a currently-defined ISBN group range. This means that some
 * numbers with otherwise correct check digits may be rejected.
 */
export function validateISBN(maybeISBN: string): boolean {
  return !!parse(maybeISBN);
}

/**
 * If the given string is a valid ISBN (i.e. as per `validateISBN`), return all
 * equivalent ISBNs (ISBN-13 and, if applicable, ISBN-10).
 *
 * Given a valid ISBN-10, return it and its 978-prefixed ISBN-13 equivalent.
 *
 * Given a valid 978-prefixed ISBN-13, return it and its ISBN-10 equivalent.
 *
 * Given a valid non-978-prefixed ISBN-13, return just it.
 *
 * Returned values are the non-hyphenated versions of the ISBN.
 *
 * If the given string is not a valid ISBN, return just a "normalized" version
 * of the string (stripped of spaces and hyphens).
 */
export function equivalentISBNs(isbn: string): [string] | [string, string] {
  const validISBN = parse(isbn);
  if (validISBN?.isbn10 && validISBN.isbn13) return [validISBN.isbn13, validISBN.isbn10];
  else if (validISBN?.isbn13) return [validISBN.isbn13];
  else return [normalizeISBN(isbn)];
}
