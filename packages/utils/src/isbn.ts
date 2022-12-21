// parse Open Library resources to find ISBNs of other editions of given ISBN

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
  async function more(isbn: string): Promise<EditionsISBNResults> {
    const response = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
    const edition = (() => {
      try { return JSON.parse(response) } catch (e) {
        throw new ContentError(`isbn/${isbn}.json response is not parseable as JSON`);
      }
    })();
    if (!isObject(edition))
      throw new ContentError(`isbn/${isbn}.json response is not an object`);

    if (!hasArrayProperty('works', edition))
      throw new ContentError(`isbn/${isbn}.json response .works is missing or not an array`);
    if (edition.works.length < 1)
      throw new ContentError(`isbn/${isbn}.json response .works is empty`);

    const workIds = edition.works.map((workObj, index) => {
      if (!isObject(workObj))
        return new ContentError(`isbn/${isbn}.json response .works[${index}] is missing or not an object`);
      if (!hasStringProperty('key', workObj))
        return new ContentError(`isbn/${isbn}.json response .works[${index}].key is missing or not a string`);

      const workKey: string = workObj.key;
      const prefix = '/works/';

      if (!workKey.startsWith(prefix))
        return new ContentError(`isbn/${isbn}.json response .works[${index}].key (${workKey}) does not start with ${prefix}`);

      return workKey.slice(prefix.length);
    });

    const { valid: validWorkIds, faults: workFaults } = workIds.reduce((partition, workId) => {
      if (isString(workId)) partition.valid.add(workId);
      else partition.faults.push(workId);
      return partition;
    }, { valid: new Set(), faults: [] as ContentError[] });

    if (validWorkIds.size < 1) {
      const newFault = new ContentError(`isbn/${isbn}.json no valid workIds`);
      if (workFaults.length < 1) throw newFault;
      if (workFaults.length == 1) throw workFaults[0];
      return {
        workFaults: [newFault].concat(workFaults),
        editionsFaults: [],
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function convertError(err: any) {
      return err instanceof ContentError ? err : new ContentError(err.toString());
    }

    type Results = { isbns: Set<string>, faults: ContentError[] };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function addError(results: Results, err: any): Results {
      return { ...results, faults: results.faults.concat([convertError(err)]) };
    }

    function combineResults(results: Results, newResults: Results): Results {
      function* concatIterables<T>(...iterables: Iterable<T>[]): Iterable<T> {
        for (const iterable of iterables) {
          yield* iterable;
        }
      }
      return {
        isbns: new Set(concatIterables(results.isbns, newResults.isbns)),
        faults: results.faults.concat(newResults.faults),
      };
    }

    const EditionsURLPrefix = 'https://openlibrary.org/works/';

    async function processEditionsURL(fetch: Fetcher, url: string) {
      const response = await fetch(url);
      const editionsURLTail = url.startsWith(EditionsURLPrefix) ? url.slice(EditionsURLPrefix.length) : url;
      const editions = (() => {
        try { return JSON.parse(response) } catch (e) {
          throw new ContentError(`${editionsURLTail} response is not parseable as JSON`);
        }
      })();
      if (!isObject(editions))
        throw new ContentError(`${editionsURLTail} response is not an object`);

      const faults: ContentError[] = [];
      let next: string | undefined;
      if (hasObjectProperty('links', editions) && hasProperty('next', editions.links)) {
        if (!isString(editions.links.next))
          faults.push(new ContentError(`${editionsURLTail} .entires.links.next is present but not a string`));
        else
          next = editions.links.next;
      }

      const allISBNs: Set<string> = new Set();

      if (!hasArrayProperty('entries', editions)) {
        const fault = new ContentError(`${editionsURLTail} response .entries is missing or not an array`);
        if (faults.length < 1 && !next)
          throw fault;
        else
          return { isbns: allISBNs, faults: faults.concat([fault]), ...isString(next) ? { next } : {} };
      }

      editions.entries.forEach((entry, index) => {
        const isbns: string[] = [];
        function process<K extends string>(k: K, o: unknown) {
          if (isObject(o) && hasProperty(k, o)) {
            const v = o[k];
            if (!isString(v))
              faults.push(new ContentError(`${editionsURLTail} .entries[${index}].${k} is not a string`));
            else isbns.push(v);
          }
        }
        process('isbn_10', entry);
        process('isbn_13', entry);
        if (isbns.length < 1)
          faults.push(new ContentError(`${editionsURLTail} .entries[${index}] has neither .isbn_10 nor .isbn_13`));
        isbns.forEach(isbn => allISBNs.add(normalizeISBN(isbn)));
      });
      return { isbns: allISBNs, faults, ...isString(next) ? { next } : {} };
    }

    async function processAllEditionsPages(fetch: Fetcher, url: string): Promise<Results> {
      return processEditionsURL(fetch, url).then(results => {
        if (isString(results.next))
          return processAllEditionsPages(fetch, results.next).then(
            nextResults => { return combineResults(results, nextResults) },
            err => { return addError(results, err) }
          );
        return results;
      }, err => {
        throw err;
      });
    }

    const results = (await Promise.allSettled(
      Array.from(validWorkIds).map(async workId =>
        processAllEditionsPages(fetch, `${EditionsURLPrefix}${workId}/editions.json`)))
    ).reduce((results, editionResults) => {
      if (editionResults.status == 'fulfilled') {
        return combineResults(results, editionResults.value);
      } else {
        const reason = editionResults.reason;
        return addError(results, reason);
      }
    }, { isbns: new Set(), faults: [] } as { isbns: Set<string>, faults: ContentError[] });

    if (results.isbns.size < 1) {
      const newFault = new ContentError(`no valid ISBNs among in all editions.jsons for all ${isbn} works`);
      if (workFaults.length < 1) {
        if (results.faults.length < 1) throw newFault;
        else if (results.faults.length == 1) throw results.faults[0];
      }
      return {
        workFaults,
        editionsFaults: [newFault].concat(results.faults)
      };
    }
    return { isbns: results.isbns, workFaults, editionsFaults: results.faults };
  }
  if (isbn === undefined) {
    return more;
  } else {
    return more(isbn);
  }
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
