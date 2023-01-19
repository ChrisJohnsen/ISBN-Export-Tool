import { collect, flatPipe, filter } from './functional.js';
import { equivalentISBNs } from './isbn.js';
import { reduceCSV, Row } from './csv.js';
import {
  Fetcher,
  ContentError, type EditionsISBNResults,
} from './editions-common.js';
import { otherEditionsOfISBN as otherEditionsOfISBN__OpenLibrary_WorkEditions } from './editions-openlibrary-work.js';
import { otherEditionsOfISBN as otherEditionsOfISBN__OpenLibrary_Search } from './editions-openlibrary-search.js';
import { otherEditionsOfISBN as otherEditionsOfISBN__LibraryThing_ThingISBN } from './editions-librarything-thingisbn.js';
import { type CacheCheck, CacheControl, cacheEditionsPromisor } from './cache.js';

import pThrottle from 'p-throttle';
import pLimit from 'p-limit';
import * as t from 'typanion';

export async function missingISBNs(csv: string, shelf: string): Promise<Row[]> {
  return await reduceCSV(csv, collect(
    flatPipe(
      filter(onShelf(shelf)),
      filter(row => rowISBNs(row).length == 0),
    )));
}

export async function getISBNs(
  csv: string,
  shelf: string,
  { bothISBNs = false, otherEditions = false }: {
    bothISBNs?: boolean,
    otherEditions?: {
      fetcher: Fetcher
      cacheData?: CacheData,
      reporter?: ProgressReporter,
    } | false,
  } = {},
): Promise<Set<string>> {

  const csvISBNs = new Set(await reduceCSV(csv, collect(
    row => onShelf(shelf, row)
      ? rowISBNs(row).slice(0, 1)
      : []
  )));

  const editionISBNs =
    !otherEditions
      ? csvISBNs
      : await fetchOtherEditionISBNs(csvISBNs, otherEditions.fetcher,
        otherEditions.cacheData, otherEditions.reporter);

  const allISBNs =
    !bothISBNs
      ? editionISBNs
      : (() => {
        const bothISBNs = new Set<string>;
        editionISBNs.forEach(isbn => equivalentISBNs(isbn).forEach(isbn => bothISBNs.add(isbn)));
        return bothISBNs;
      })();

  return allISBNs;
}

function onShelf(shelf: string, row: Row): boolean;
function onShelf(shelf: string): (row: Row) => boolean;
function onShelf(shelf: string, row?: Row): ((row: Row) => boolean) | boolean {

  const _onShelf = (row: Row) => row
    .Bookshelves
    .split(/\s*,\s*/)
    .includes(shelf);

  if (typeof row == 'undefined')
    return _onShelf;
  else
    return _onShelf(row);
}

function rowISBNs(row: Row): string[] {
  return (['ISBN13', 'ISBN'] as const)
    .flatMap(isbnKey => isbnKey in row ? [row[isbnKey]] : [])
    .map(isbnStr => isbnStr.replace(/^="(.*)"$/, '$1'))
    .filter(isbn => isbn != '');
}

export type CacheData = Record<string, unknown | undefined>;

async function fetchOtherEditionISBNs(
  isbnsIterable: Iterable<string>,
  fetcher: Fetcher,
  cacheData?: CacheData,
  reporter?: ProgressReporter,
): Promise<Set<string>> {

  // gather the ISBNs
  const isbns = Array.from(isbnsIterable);

  const editionsOfs = editionsOfServices(10, fetcher, cacheData, reporter);

  const oneOf = <T>(arr: T[]) => arr[Math.trunc(Math.random() * arr.length)];

  // assign "editions of" service to each ISBN
  const assignments = isbns.map(isbn => ({ isbn, editionsOf: oneOf(editionsOfs) }));

  // collect the ISBNs that are already cached in its assigned "editions of" service
  const { cachedISBNs, uncachedAssignments } = assignments.reduce(
    (r, assignment) => {
      const { isbn, editionsOf } = assignment;
      const cacheTry = editionsOf.checkCache(isbn);
      if (cacheTry.hit) {
        try { reporter?.({ event: 'service cache hit', service: assignment.editionsOf.serviceName, isbn }) } catch { /* ignore */ }
        cacheTry.value.forEach(isbn => r.cachedISBNs.add(isbn));
      }
      else
        r.uncachedAssignments.push(assignment);
      return r;
    },
    { cachedISBNs: new Set, uncachedAssignments: [] } as
    { cachedISBNs: Set<string>, uncachedAssignments: typeof assignments });

  // report the assignments
  try {
    const map = new Map<string, Set<string>>;
    const set = <K, V>(map: Map<K, Set<V>>, k: K) => {
      {
        const s = map.get(k);
        if (s) return s;
      }
      const s = new Set<V>;
      map.set(k, s);
      return s;
    };
    uncachedAssignments.forEach(({ isbn, editionsOf: { serviceName } }) => { set(map, serviceName).add(isbn) });
    reporter?.({
      event: 'query plan',
      plan: Object.fromEntries(map.entries())
    });
  } catch { /* ignore */ }

  // start an "editions of" query for each un-cached ISBN
  const isbnFetches = await Promise.allSettled(
    uncachedAssignments.map(({ isbn, editionsOf }) => editionsOf.query(isbn)));

  // cache the results
  editionsOfs.forEach(cached => cached.saveCache());

  // return the combined results, logging rejections
  return isbnFetches.reduce((set, settlement) => {
    if (settlement.status == 'fulfilled') {
      for (const isbn of settlement.value) set.add(isbn);
    } else {
      try { reporter?.({ event: 'rejection', reason: settlement.reason }) } catch { /* ignore */ }
    }
    return set;
  }, cachedISBNs);
}

const beforeAndAfter = <A extends unknown[], R>(
  before: (args: A) => void,
  wrappee: (...args: A) => Promise<R>,
  after: (args: A, resolved: R, elapsed: number) => void,
): typeof wrappee => (...args) => {
  try { before(args) } catch { /* ignore */ }
  const start = Date.now();
  const result = wrappee(...args);
  result.then(resolved => after(args, resolved, Date.now() - start)).catch(/* ignore */);
  return result;
};

const reportBeforeAndAfter = <A extends unknown[], R>(
  before: (args: A) => ProgressReport,
  wrappee: (...args: A) => Promise<R>,
  after: (args: A, resolved: R, elapsed: number) => ProgressReport,
  reporter?: ProgressReporter,
): typeof wrappee =>
  reporter
    ? beforeAndAfter(
      args => reporter(before(args)),
      wrappee,
      (args, resolved, elapsed) => reporter(after(args, resolved, elapsed)),
    )
    : wrappee;

function editionsOfServices(
  limitn: number,
  fetcher: Fetcher,
  cacheData?: CacheData,
  reporter?: ProgressReporter,
): {
  serviceName: string,
  checkCache: (isbn: string) => CacheCheck<Set<string>>,
  query: (isbn: string) => Promise<Set<string>>,
  saveCache: () => void,
}[] {

  // overall parallelism limit
  const limit = pLimit(limitn);

  // separate throttles to be applied to fetches from different services
  const olThrottle = (fetcher: Fetcher) =>
    pThrottle({ limit: 1, interval: 100, strict: true })(fetcher);  // XXX 1/1000?
  const ltThrottle = (fetcher: Fetcher) =>
    pThrottle({ limit: 1, interval: 100, strict: true })(fetcher);  // XXX 1/1000

  // "editions of" functions, where we store their cached data, and the throttles to apply to their fetches
  const editionsOfSetups: [
    serviceName: string,
    editionsOf: (f: Fetcher) => (i: string) => Promise<EditionsISBNResults>,
    throttler: (fetcher: Fetcher) => Fetcher,
  ][] = [
      ['Open Library WorkEditions', otherEditionsOfISBN__OpenLibrary_WorkEditions, olThrottle],
      ['Open Library Search', otherEditionsOfISBN__OpenLibrary_Search, olThrottle],
      ['LibraryThing ThingISBN', otherEditionsOfISBN__LibraryThing_ThingISBN, ltThrottle],
    ];

  // how to save and restore (as JSON) the argument and resolution values
  const savers = {
    saveArgument: (argument: string) => argument,
    saveResolution: Array.from,
  };
  const restorers = {
    restoreArgument: (savedArgument: unknown) => t.as(savedArgument, t.isString(), { throw: true }),
    restoreResolution: (savedResolution: unknown) => new Set(t.as(savedResolution, t.isArray(t.isString()), { throw: true })),
  };

  // package up all the limiting, progress capture, caching (and restoring/saving), throttling, and error handling around each "editions of" service
  return editionsOfSetups.map(([serviceName, editionsOf, throttle]) => {

    // throttle and report on fetcher
    const throttledFetcher = throttle(
      reportBeforeAndAfter(
        ([url]) => ({ event: 'fetch started', service: serviceName, url }),
        fetcher,
        ([url], _, elapsed) => ({ event: 'fetch finished', service: serviceName, url, elapsed }),
        reporter));

    // report on editions of
    const trackedEditionsOf = reportBeforeAndAfter(
      ([isbn]) => ({ event: 'service query started', service: serviceName, isbn }),
      editionsOf(throttledFetcher),
      ([isbn], resolved) => ({
        event: 'service query finished', service: serviceName, isbn: isbn,
        isbns: resolved.isbns, warnings: resolved.warnings, faults: resolved.temporaryFaults
      }),
      reporter);

    // simplify to just he ISBNs (warnings and faults already reported)
    const justISBNs = async (isbn: string): Promise<CacheControl<Set<string>>> => {
      const result = await trackedEditionsOf(isbn);
      const short = { forMillis: 24 * 60 * 60 * 1000 };
      const normal = { forMillis: 30 * 24 * 60 * 60 * 1000 };
      if (result.temporaryFaults.length > 1)
        return new CacheControl(result.isbns, short);
      return new CacheControl(result.isbns, normal);
    };

    // cache the isbn -> isbns result
    const cacher = cacheEditionsPromisor(justISBNs, {
      import: cacheData?.[serviceName],
      ...restorers,
    });

    // limit parallelism and report rejections
    const limited = (isbn: string) => limit(cacher, isbn).catch(rejected => {
      try { reporter?.({ event: 'rejection', reason: rejected }) } catch { /* ignore */ }
      return new Set([isbn]);
    });

    return {
      serviceName,
      checkCache: (isbn: string) => cacher.checkCache(isbn),
      query: limited,
      saveCache: () => { if (cacheData) cacheData[serviceName] = cacher.saveCache(savers); },
    };
  });
}

export type ProgressReport =
  | { event: 'service cache hit', service: string, isbn: string }
  | { event: 'query plan', plan: Record<string, Set<string>> }
  | { event: 'service query started', service: string, isbn: string }
  | { event: 'service query finished', service: string, isbn: string, isbns: Set<string>, warnings: ContentError[], faults: ContentError[] }
  | { event: 'rejection', reason: any } // eslint-disable-line @typescript-eslint/no-explicit-any
  | { event: 'fetch started', service: string, url: string }
  | { event: 'fetch finished', service: string, url: string, elapsed: number };
export type ProgressReporter = (report: ProgressReport) => void;
