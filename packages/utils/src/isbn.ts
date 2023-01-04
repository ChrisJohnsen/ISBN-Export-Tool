// parse Open Library resources to find ISBNs of other editions of given ISBN

const OlUrlPrefix = 'https://openlibrary.org';

export type Fetcher = (url: string) => Promise<string>;

export class ContentError {
  constructor(public description: string) { }
}

export interface EditionsISBNResults {
  isbns?: Set<string>,
  workFaults: ContentError[],
  editionsFaults: ContentError[],
}

/**
 * Fetch from Open Library (openlibrary.org) the ISBNs of all editions of the
 * given ISBN.
 *
 * The result ISBNs are not validated (e.g. with validateISBN), but they are
 * de-duplicated since they are returned in a Set<string>.
 *
 * Errors encountered while fetching or processing the initial ISBN-based query
 * are reported in `workFaults`. Errors encountered while fetching or processing
 * editions pages are reported in `editionsFaults`.
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

    const { data: workIDs, faults: workFaults } = await getWorkIDsForISBN(fetch, isbn);

    if (workIDs.size < 1) return { workFaults, editionsFaults: [] };

    const { data: isbns, faults: editionsFaults } =
      (await Promise.allSettled(Array.from(workIDs).map(
        async workID => processAllEditionsPages(fetch, editionsURL(workID)))))
        .reduce(absorbSettledResult, new EditionsResult);

    if (isbns.size < 1) {

      const newFault = new ContentError(`no valid ISBNs among all editions.jsons for all ${isbn} works`);

      if (workFaults.length < 1) {
        if (editionsFaults.length < 1) throw newFault;
        else if (editionsFaults.length == 1) throw editionsFaults[0];
      }

      return {
        workFaults,
        editionsFaults: [newFault].concat(editionsFaults)
      };
    }
    return { isbns, workFaults, editionsFaults };

    function editionsURL(workID: string) {
      return `${OlUrlPrefix}/works/${workID}/editions.json`;
    }

    function absorbSettledResult(result: EditionsResult, settled: PromiseSettledResult<EditionsResult>) {
      if (settled.status == 'fulfilled')
        return result.absorb(settled.value);
      else
        return result.addError(settled.reason);
    }
  }
}

import * as t from 'typanion';

class StringsAndFaults {
  data: Set<string> = new Set;
  faults: ContentError[] = [];
  addString(datum: string) {
    this.data.add(datum);
    return this;
  }
  addFault(fault: ContentError) {
    this.faults.push(fault);
    return this;
  }
}

async function getWorkIDsForISBN(fetch: Fetcher, isbn: string): Promise<StringsAndFaults> {

  const urlTail = `/isbn/${isbn}.json`;

  const response = await fetch(`${OlUrlPrefix}${urlTail}`);

  const json = (() => {
    try { return JSON.parse(response) } catch (e) {
      throw new ContentError(`${urlTail} response is not parseable as JSON`);
    }
  })();

  // .works is an array?
  const hasWorksArray = t.isPartial({ works: t.isArray(t.isUnknown()) });
  const validation = t.as(json, hasWorksArray, { errors: true });
  if (validation.errors)
    throw new ContentError(`${urlTail}: ${validation.errors.join('; ')}`);
  const edition = validation.value;

  if (edition.works.length < 1)
    throw new ContentError(`${urlTail} response .works is empty`);

  // collect workIDs from .works[n].key
  const result = edition.works.reduce(
    (result: StringsAndFaults, workObj, index) => {

      // .works[n].key is a string?
      const hasKey = t.isPartial({ key: t.isString() });
      const validation = t.as(workObj, hasKey, { errors: true });
      if (validation.errors)
        return result.addFault(new ContentError(`${urlTail}.works[${index}] malformed?: ${validation.errors.join('; ')}`));
      const workKey: string = validation.value.key;

      // workID has /works/ prefix?
      const prefix = '/works/';
      if (!workKey.startsWith(prefix))
        return result.addFault(new ContentError(`${urlTail} response .works[${index}].key (${workKey}) does not start with ${prefix}`));

      // strip /works/ prefix
      return result.addString(workKey.slice(prefix.length));
    },
    new StringsAndFaults);

  if (result.data.size < 1) {

    const newFault = new ContentError(`${urlTail} has no valid workIDs`);

    if (result.faults.length < 1) throw newFault;
    if (result.faults.length == 1) throw result.faults[0];

    return result.addFault(newFault);
  }

  return result;
}

class EditionsResult extends StringsAndFaults {
  next?: string;
  setNext(next: string) {
    this.next = next;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addError(err: any) {
    const fault = err instanceof ContentError ? err : new ContentError(err.toString());
    return this.addFault(fault);
  }
  absorb(other: StringsAndFaults) {
    other.data.forEach(datum => this.data.add(datum));
    other.faults.forEach(fault => this.faults.push(fault));
    return this;
  }
}

async function processAllEditionsPages(fetch: Fetcher, url: string): Promise<EditionsResult> {

  return processEditionsURL(fetch, url).then(

    results => results.next

      ? processAllEditionsPages(fetch, results.next)

        .then(
          nextResults => results.absorb(nextResults),
          err => results.addError(err)
        )

      : results,

    err => { throw err });
}

async function processEditionsURL(fetch: Fetcher, url: string): Promise<EditionsResult> {

  const response = await fetch(url);

  const urlTail = url.startsWith(OlUrlPrefix) ? url.slice(OlUrlPrefix.length) : url;

  // parse JSON
  const json = (() => {
    try { return JSON.parse(response) } catch (e) {
      throw new ContentError(`${urlTail} response is not parseable as JSON`);
    }
  })();

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
    return result.addFault(new ContentError(`${urlTail} malformed?: ${validation.errors.join('; ')}`));
  const editions = validation.value;

  // collect ISBNs from .entries[n].isbn_{10,13}[n]
  return editions.entries.reduce(
    (result: EditionsResult, entry, index) => {

      const entryResult = new EditionsResult;

      [...entry.isbn_10 ?? [], ...entry.isbn_13 ?? []]
        .forEach(isbn => entryResult.addString(normalizeISBN(isbn)));

      if (entryResult.data.size < 1)
        entryResult.addFault(new ContentError(`${urlTail} .entries[${index}] has no ISBNs`));

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
