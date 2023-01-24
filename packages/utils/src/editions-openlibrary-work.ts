import { Fetcher, EditionsISBNResults, ContentError } from './editions-common.js';
import { fetcherResponseOrFault, EditionsResult, StringsAndFaults } from "./editions-internal.js";
import * as t from 'typanion';
import { normalizeISBN } from './isbn.js';

// Parse Open Library resources to find ISBNs of other editions of given ISBN.
//
// This variation is a multi-step process:
// 1. /isbn/<isbn>.json
//   - get the Open Library work ID of the ISBN-identified publication
// 2. /works/<workID>/editions.json
//   - get the ISBNs of the listed editions of the same work

const OlUrlPrefix = 'https://openlibrary.org';

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
    return isbns.asEditionsISBNResults();

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

async function getWorkIDsForISBN(fetch: Fetcher, isbn: string): Promise<StringsAndFaults> {

  const urlTail = `/isbn/${isbn}.json`;

  const response = fetcherResponseOrFault(urlTail, await fetch(`${OlUrlPrefix}${urlTail}`));

  if (typeof response != 'string') return new StringsAndFaults(response);

  let json;
  try {
    json = JSON.parse(response);
  } catch {
    return new StringsAndFaults({ temporary: `${urlTail} response is not parseable as JSON` });
  }

  // .works is an array?
  const hasWorksArray = t.isPartial({ works: t.isArray(t.isUnknown()) });
  const validation = t.as(json, hasWorksArray, { errors: true });
  if (validation.errors)
    return new StringsAndFaults({ temporary: `${urlTail} malformed?: ${validation.errors.join('; ')}` });
  const edition = validation.value;

  if (edition.works.length < 1)
    return new StringsAndFaults({ temporary: `${urlTail} response .works is empty` });

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

  const urlTail = url.startsWith(OlUrlPrefix) ? url.slice(OlUrlPrefix.length) : url;

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

  // if there is a next page (.links.next) capture it right away
  if (t.isPartial({ links: t.isPartial({ next: t.isString() }) })(json))
    result.next = json.links.next;

  // has .entries[n]?
  const isEditions = t.isPartial({ entries: t.isArray(t.isUnknown()) });
  const validation = t.as(json, isEditions, { errors: true });
  if (validation.errors)
    return result.addTemporaryFault(`${urlTail} malformed?: ${validation.errors.join('; ')}`);
  const editions = validation.value;

  // collect ISBNs from .entries[n].isbn_{10,13}[n]
  return editions.entries.reduce(
    (result: EditionsResult, unknownEntry, index) => {

      // .entries[n] has .isbn_{10,13}[n]?
      const validation = t.as(unknownEntry, t.isPartial({
        isbn_10: t.isOptional(t.isArray(t.isString())),
        isbn_13: t.isOptional(t.isArray(t.isString())),
      }), { errors: true });
      if (validation.errors)
        return result.addWarning(`${urlTail} .entries[${index}] malformed?: ${validation.errors.join('; ')}`);
      const entry = validation.value;

      const entryResult = new EditionsResult;

      [...entry.isbn_10 ?? [], ...entry.isbn_13 ?? []]
        .forEach(isbn => entryResult.addString(normalizeISBN(isbn)));

      if (entryResult.set.size < 1)
        entryResult.addWarning(`${urlTail} .entries[${index}] has no ISBNs`);

      return result.absorb(entryResult);
    },
    result);
}
