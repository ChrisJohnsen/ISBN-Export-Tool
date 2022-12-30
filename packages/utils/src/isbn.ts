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

    const { workIDs, faults: workFaults } = await getWorkIDsForISBN(fetch, isbn);

    if (workIDs.size < 1) return { workFaults, editionsFaults: [] };

    const { isbns, faults: editionsFaults } =
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

class WorkIDsResult {
  workIDs: Set<string> = new Set;
  faults: ContentError[] = [];
  addWorkID(workID: string) {
    this.workIDs?.add(workID);
    return this;
  }
  addFault(fault: ContentError) {
    this.faults.push(fault);
    return this;
  }
}

async function getWorkIDsForISBN(fetch: Fetcher, isbn: string): Promise<WorkIDsResult> {

  const urlTail = `/isbn/${isbn}.json`;

  const response = await fetch(`${OlUrlPrefix}${urlTail}`);

  const edition = (() => {
    try { return JSON.parse(response) } catch (e) {
      throw new ContentError(`${urlTail} response is not parseable as JSON`);
    }
  })();

  if (!isObject(edition))
    throw new ContentError(`${urlTail} response is not an object`);
  if (!hasArrayProperty('works', edition))
    throw new ContentError(`${urlTail} response .works is missing or not an array`);
  if (edition.works.length < 1)
    throw new ContentError(`${urlTail} response .works is empty`);

  const result = edition.works.reduce(
    (result: WorkIDsResult, workObj, index) => {

      if (!isObject(workObj))
        return result.addFault(new ContentError(`${urlTail} response .works[${index}] is missing or not an object`));
      if (!hasStringProperty('key', workObj))
        return result.addFault(new ContentError(`${urlTail} response .works[${index}].key is missing or not a string`));

      const workKey: string = workObj.key;
      const prefix = '/works/';

      if (!workKey.startsWith(prefix))
        return result.addFault(new ContentError(`${urlTail} response .works[${index}].key (${workKey}) does not start with ${prefix}`));

      return result.addWorkID(workKey.slice(prefix.length));
    },
    new WorkIDsResult);

  if (result.workIDs.size < 1) {

    const newFault = new ContentError(`${urlTail} has no valid workIDs`);

    if (result.faults.length < 1) throw newFault;
    if (result.faults.length == 1) throw result.faults[0];

    return result.addFault(newFault);
  }

  return result;
}

class EditionsResult {
  isbns: Set<string> = new Set();
  faults: ContentError[] = [];
  next?: string;
  addISBN(isbn: string) {
    this.isbns.add(isbn);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addError(err: any) {
    const fault = err instanceof ContentError ? err : new ContentError(err.toString());
    return this.addFault(fault);
  }
  addFault(fault: ContentError) {
    this.faults.push(fault);
    return this;
  }
  throwOrAddFault(fault: ContentError) {
    if (this.faults.length < 1 && !this.next) throw fault;
    this.addFault(fault);
    return this;
  }
  absorb(other: EditionsResult) {
    other.isbns.forEach(isbn => this.isbns.add(isbn));
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

  const editions = (() => {
    try { return JSON.parse(response) } catch (e) {
      throw new ContentError(`${urlTail} response is not parseable as JSON`);
    }
  })();
  if (!isObject(editions))
    throw new ContentError(`${urlTail} response is not an object`);

  const result = new EditionsResult;

  if (hasObjectProperty('links', editions) && hasProperty('next', editions.links)) {
    if (!isString(editions.links.next))
      result.addFault(new ContentError(`${urlTail} .entires.links.next is present but not a string`));
    else {
      result.next = editions.links.next;
    }
  }

  if (!hasArrayProperty('entries', editions))
    return result.throwOrAddFault(new ContentError(`${urlTail} response .entries is missing or not an array`));

  return editions.entries.reduce(
    (result: EditionsResult, entry, index) => {

      const entryResult = ['isbn_10', 'isbn_13'].reduce(
        (entryResult, k) => processEditionsEntry(entryResult, entry, k),
        new EditionsResult);

      if (entryResult.isbns.size < 1)
        entryResult.addFault(new ContentError(`${urlTail} .entries[${index}] has no ISBNs`));

      return result.absorb(entryResult);

      function processEditionsEntry(result: EditionsResult, entry: unknown, isbnKey: string): EditionsResult {

        if (isObject(entry) && hasProperty(isbnKey, entry)) {

          const entryArray = entry[isbnKey];

          if (!Array.isArray(entryArray))
            result.addFault(new ContentError(`${urlTail} .entries[${index}].${isbnKey} is not an array`));
          else {

            entryArray.forEach((isbn, i) => {

              if (!isString(isbn))
                result.addFault(new ContentError(`${urlTail} .entries[${index}].${isbnKey}[${i}] is not a string`));
              else
                result.addISBN(normalizeISBN(isbn));

            });
          }
        }

        return result;
      }
    },
    result);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isString(value: any): value is string {
  return typeof value == 'string';
}

function hasProperty<K extends string, O extends object, T>
  (key: K, obj: O): obj is O & { [k in K]: T } {
  return key in obj;
}

function hasStringProperty<K extends string, O extends Record<string, unknown>>
  (keyString: K, obj: O): obj is O & { [k in K]: string } {
  return keyString in obj && isString(obj[keyString]);
}

function hasArrayProperty<K extends string, O extends Record<string, unknown>, T>
  (keyString: K, obj: O): obj is O & { [k in K]: T[] } {
  return keyString in obj && obj[keyString] && Array.isArray(obj[keyString]);
}

function hasObjectProperty<K extends string, O extends Record<string, unknown>>
  (keyString: K, obj: O): obj is O & { [k in K]: Record<PropertyKey, unknown> } {
  return hasProperty(keyString, obj) && isObject(obj[keyString]);
}

function isObject<K extends PropertyKey>
  (maybeObject: any): maybeObject is Record<K, unknown> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return maybeObject && typeof maybeObject == 'object';
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
