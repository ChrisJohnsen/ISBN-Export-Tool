import { equivalentISBNs } from './isbn.js';
import { type Row } from './csv.js';
import {
  type Fetcher,
  type ContentError, type EditionsISBNResults,
} from './editions-common.js';
import { otherEditionsOfISBN as otherEditionsOfISBN__OpenLibrary_WorkEditions } from './editions-openlibrary-work.js';
import { otherEditionsOfISBN as otherEditionsOfISBN__OpenLibrary_Search } from './editions-openlibrary-search.js';
import { otherEditionsOfISBN as otherEditionsOfISBN__LibraryThing_ThingISBN } from './editions-librarything-thingisbn.js';
import { type CacheCheck, CacheControl, cacheEditionsPromisor } from './cache.js';

import pThrottle from 'p-throttle';
import pLimit from 'p-limit';
import * as t from 'typanion';

export interface ExportFormat {
  readonly format: string,
  groupInfo(rows: Iterable<Row>): Map<string, Map<string, number>>,
  rowsInGroup(rows: Iterable<Row>, groupKind: string, groupName: string): Row[],
  missingAndISBNs(rows: Iterable<Row>): { missingISBN: Row[], isbns: Set<string> },
  readonly mainColumns: Set<string>,
}
export const GoodreadsFormat: ExportFormat = {
  format: 'Goodreads',
  groupInfo: groupInfo(row => groups('Shelf', Goodreads_getShelves(row).shelves)),
  rowsInGroup: rowsInGroup((group, row) =>
    group.kind == 'Shelf' && Goodreads_onShelf(group.name, row)),
  missingAndISBNs: missingAndISBNs(Goodreads_rowISBNs),
  mainColumns: new Set(['Book Id', 'Title', 'Author', 'Exclusive Shelf', 'Bookshelves']),
};
export const LibraryThingFormat: ExportFormat = {
  format: 'Goodreads',
  groupInfo: groupInfo(row =>
    groups('Collection', LibraryThing_getCollections(row))
      .concat(groups('Tag', LibraryThing_getTags(row)))),
  rowsInGroup: rowsInGroup((group, row) =>
    group.kind == 'Collection' && LibraryThing_inCollection(group.name, row)
    || group.kind == 'Tag' && LibraryThing_taggedAs(group.name, row)),
  missingAndISBNs: missingAndISBNs(LibraryThing_rowISBNs),
  mainColumns: new Set(['Book Id', 'Title', 'Primary Author', 'Secondary Author', 'Collections', 'Tags']),
};
export function guessFormat(rows: Iterable<Row>): ExportFormat {
  const cols = allColumns(rows);
  const hasAll = (tests: string[]) => tests.every(c => cols.has(c));
  if (hasAll(['Book Id', 'Title', 'Author', 'Exclusive Shelf', 'Bookshelves', 'ISBN', 'ISBN13']))
    return GoodreadsFormat;
  else if (hasAll(['Book Id', 'Title', 'Primary Author', 'Collections', 'Tags', 'ISBN', 'ISBNs']))
    return LibraryThingFormat;
  else
    throw `unrecognized format with columns: ${Array.from(cols).join(', ')}`;
}

type Group = { kind: string, name: string };
function groups(kind: string, names: Set<string>): Group[] {
  return Array.from(names).map(name => ({ name, kind }));
}
function allColumns(rows: Iterable<Row>): Set<string> {
  const columns = new Set<string>;
  for (const row of rows) {
    Object.getOwnPropertyNames(row).forEach(column => columns.add(column));
  }
  return columns;
}
function groupInfo(extractGroups: (row: Row) => Group[]): (rows: Iterable<Row>) => Map<string, Map<string, number>> {
  return rows => {
    const info = new Map<string, Map<string, number>>;
    for (const row of rows) {
      extractGroups(row).forEach(group => {
        const kindInfo = (() => {
          {
            const value = info.get(group.kind);
            if (value) return value;
          }
          const value = new Map<string, number>;
          info.set(group.kind, value);
          return value;
        })();
        const count = kindInfo.get(group.name) ?? 0;
        kindInfo.set(group.name, count + 1);
      });
    }
    return info;
  };
}
function rowsInGroup(inGroup: (group: Group, row: Row) => boolean): (allRows: Iterable<Row>, groupKind: string, groupName: string) => Row[] {
  return (allRows, kind, name) => {
    const rows = new Array<Row>;
    for (const row of allRows) {
      if (inGroup({ kind, name }, row))
        rows.push(row);
    }
    return rows;
  };
}
function missingAndISBNs(extractISBNs: (row: Row) => string[]): (rows: Iterable<Row>) => { missingISBN: Row[], isbns: Set<string> } {
  return rows => {
    const missingISBN = new Array<Row>;
    const isbns = new Set<string>;
    for (const row of rows) {
      const rowIsbns = extractISBNs(row);
      if (rowIsbns.length == 0)
        missingISBN.push(row);
      else
        rowIsbns.forEach(isbn => isbns.add(equivalentISBNs(isbn)[0]));
    }
    return { missingISBN, isbns };
  };
}

export async function getEditionsOf(
  isbns: Iterable<string>,
  opts: {
    fetcher: Fetcher
    services?: EditionsServices,
    cacheData?: CacheData,
    reporter?: ProgressReporter,
    throttle?: boolean,
  }
): Promise<Set<string>> {
  return await fetchOtherEditionISBNs(isbns, opts.fetcher,
    opts.throttle ?? true, opts.services, opts.cacheData, opts.reporter);
}

export function bothISBNsOf(isbns: Iterable<string>): Set<string> {
  const bothISBNs = new Set<string>;
  for (const isbn of isbns) {
    equivalentISBNs(isbn).forEach(isbn => bothISBNs.add(isbn));
  }
  return bothISBNs;
}

function Goodreads_getShelves(row: Row): { exclusive?: string, shelves: Set<string> } {
  const exclusive = row['Exclusive Shelf'];
  const bookshelves = !row.Bookshelves ? [] : row.Bookshelves.split(/\s*,\s*/);
  const shelves = new Set(bookshelves);
  if (exclusive) {
    shelves.add(exclusive);
  }
  return { exclusive, shelves };
}

function Goodreads_onShelf(shelf: string, row: Row): boolean;
function Goodreads_onShelf(shelf: string): (row: Row) => boolean;
function Goodreads_onShelf(shelf: string, row?: Row): ((row: Row) => boolean) | boolean {

  const _onShelf = (row: Row) => Goodreads_getShelves(row).shelves.has(shelf);

  if (typeof row == 'undefined')
    return _onShelf;
  else
    return _onShelf(row);
}

function Goodreads_rowISBNs(row: Row): string[] {
  return (['ISBN13', 'ISBN'] as const)
    .flatMap(isbnKey => {
      const isbnStr = row[isbnKey];
      return isbnStr ? [isbnStr] : [];
    })
    .map(isbnStr => isbnStr.replace(/^="(.*)"$/, '$1'))
    .filter(isbn => isbn != '');
}

function splitAndTrim(csv: string): string[] {
  return csv.split(',').map(v => v.trim());
}

function LibraryThing_getCollections(row: Row): Set<string> {
  const collections = row.Collections ? splitAndTrim(row.Collections) : [];
  return new Set(collections);
}

function LibraryThing_getTags(row: Row): Set<string> {
  const tags = row.Tags ? splitAndTrim(row.Tags) : [];
  return new Set(tags);
}

function LibraryThing_inCollection(collection: string, row: Row): boolean {
  if (row.Collections)
    return splitAndTrim(row.Collections).includes(collection);
  return false;
}

function LibraryThing_taggedAs(tag: string, row: Row): boolean {
  if (row.Tags)
    return splitAndTrim(row.Tags).includes(tag);
  return false;
}

function LibraryThing_rowISBNs(row: Row): string[] {
  const isbns = new Array<string>;
  if (row.ISBN)
    isbns.push(row.ISBN.replace(/^\s*\[(.*)\]\s*$/, '$1'));
  if (row.ISBNS)
    isbns.push(...splitAndTrim(row.ISBNS));
  return isbns.filter(isbn => isbn != '');
}

export type CacheData = Record<string, unknown | undefined>;

async function fetchOtherEditionISBNs(
  isbnsIterable: Iterable<string>,
  fetcher: Fetcher,
  throttle: boolean,
  services?: EditionsServices,
  cacheData?: CacheData,
  reporter?: ProgressReporter,
): Promise<Set<string>> {

  // gather the ISBNs
  const isbns = Array.from(isbnsIterable);

  const { editionsOfs, abortAll } = editionsOfServices(10, fetcher, throttle, services, cacheData, reporter);

  try { reporter?.({ event: 'abort fn', fn: abortAll }) } catch { /* ignore */ }

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
        mergeOtherCaches(editionsOf.serviceName, isbn, r.cachedISBNs);
      }
      else
        r.uncachedAssignments.push(assignment);
      return r;
    },
    { cachedISBNs: new Set, uncachedAssignments: [] } as
    { cachedISBNs: Set<string>, uncachedAssignments: typeof assignments });

  // report the assignments
  try {
    const map = new Map<EditionsService, Set<string>>;
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
      plan: map
    });
  } catch { /* ignore */ }

  // start an "editions of" query for each un-cached ISBN
  const isbnFetches = await Promise.allSettled(
    uncachedAssignments.map(async ({ isbn, editionsOf }) =>
      mergeOtherCaches(editionsOf.serviceName, isbn, await editionsOf.query(isbn))));

  abortAll(); // settle the abort promise

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

  function mergeOtherCaches(serviceName: EditionsService, isbn: string, isbns: Set<string>) {
    editionsOfs.forEach(otherEditionsOf => {
      if (otherEditionsOf.serviceName != serviceName) {
        const cacheTry = otherEditionsOf.checkCache(isbn);
        if (cacheTry.hit)
          cacheTry.value.forEach(isbn => isbns.add(isbn));
      }
    });
    return isbns;
  }
}

const beforeAndAfter = <A extends unknown[], R>(
  before: (args: A) => void,
  wrappee: (...args: A) => Promise<R>,
  after: (args: A, resolved: R, elapsed: number) => void,
): typeof wrappee => (...args) => {
  try { before(args) } catch { /* ignore */ }
  const start = Date.now();
  const result = wrappee(...args);
  (async () => {
    try { after(args, await result, Date.now() - start) } catch { /* ignore */ }
  })();
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

export type EditionsService =
  | 'Open Library WorkEditions'
  | 'Open Library Search'
  | 'LibraryThing ThingISBN'
  | never;
export type EditionsServices = Set<EditionsService>;
export const AllEditionsServices: Readonly<EditionsServices> = Object.freeze(new Set<EditionsService>([
  'Open Library WorkEditions',
  'Open Library Search',
  'LibraryThing ThingISBN',
]));

function editionsOfServices(
  limitn: number,
  fetcher: Fetcher,
  throttle: boolean,
  services?: EditionsServices,
  cacheData?: CacheData,
  reporter?: ProgressReporter,
): {
    editionsOfs: {
    serviceName: EditionsService,
    checkCache: (isbn: string) => CacheCheck<Set<string>>,
    query: (isbn: string) => Promise<Set<string>>,
    saveCache: () => void,
  }[],
  abortAll: () => void,
} {

  // overall parallelism limit
  const limit = pLimit(limitn);
  let limitAbort: () => void;
  // to be raced with limited calls to settle them early if we abort
  const limitAbortPromise = new Promise<never>((resolve, reject) => limitAbort = () => reject('Limited call aborted'));
  limitAbortPromise.catch(() => { /* ignore*/ }); // avoid unhandled rejection errors

  // separate throttles to be applied to fetches from different services
  const olThrottle = pThrottle({ limit: 1, interval: 1000, strict: true });
  const ltThrottle = pThrottle({ limit: 1, interval: 1000, strict: true });

  // "editions of" functions, where we store their cached data, and the throttles to apply to their fetches
  const editionsOfSetups: [
    serviceName: EditionsService,
    editionsOf: (f: Fetcher) => (i: string) => Promise<EditionsISBNResults>,
    throttler: typeof olThrottle,
  ][] = [
      ['Open Library WorkEditions', otherEditionsOfISBN__OpenLibrary_WorkEditions, olThrottle],
      ['Open Library Search', otherEditionsOfISBN__OpenLibrary_Search, olThrottle],
      ['LibraryThing ThingISBN', otherEditionsOfISBN__LibraryThing_ThingISBN, ltThrottle],
    ];

  // use all the services if none specified, or just the enabled ones
  const enabledEditionsOfSetups =
    !services
      ? editionsOfSetups
      : editionsOfSetups.filter(([serviceName]) => services.has(serviceName));

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
  const editionsOfs = enabledEditionsOfSetups.map(([serviceName, editionsOf, throttler]) => {

    // report on fetcher
    const reportingFetcher = reportBeforeAndAfter(
      ([url]) => ({ event: 'fetch started', service: serviceName, url }),
      fetcher,
      ([url], _, elapsed) => ({ event: 'fetch finished', service: serviceName, url, elapsed }),
      reporter);

    // throttle fetcher
    const throttledFetcher = throttle ? throttler(reportingFetcher) : reportingFetcher;

    // report on editions of
    const trackedEditionsOf = reportBeforeAndAfter(
      ([isbn]) => ({ event: 'service query started', service: serviceName, isbn }),
      editionsOf(throttledFetcher),
      ([isbn], resolved) => ({
        event: 'service query finished', service: serviceName, isbn: isbn,
        isbns: resolved.isbns, warnings: resolved.warnings, faults: resolved.temporaryFaults
      }),
      reporter);

    // simplify to just the ISBNs and cache duration (warnings and faults already reported)
    const justISBNs = async (isbn: string): Promise<CacheControl<Set<string>>> => {
      const result = await trackedEditionsOf(isbn);
      const short = { forMillis: 24 * 60 * 60 * 1000 };
      const normal = { forMillis: 30 * 24 * 60 * 60 * 1000 };
      const cacheTime = typeof result.cacheUntil == 'number'
        ? { until: new Date(result.cacheUntil) }
        : result.temporaryFaults.length > 1
          ? short
          : normal;
      return new CacheControl(result.isbns, cacheTime);
    };

    // cache the isbn -> isbns result
    const cacher = cacheEditionsPromisor(justISBNs, {
      import: cacheData?.[serviceName],
      ...restorers,
    });

    // limit parallelism
    const limited = (isbn: string) => limit(cacher, isbn);

    // provide a way to "abort"  calls abandoned via limit.clearQueue()
    const abortable = (isbn: string) => Promise.race([limited(isbn), limitAbortPromise]);

    // report rejections and default to just the initial ISBN
    const reported = (isbn: string) => abortable(isbn).catch(rejected => {
      try { reporter?.({ event: 'rejection', reason: rejected }) } catch { /* ignore */ }
      return new Set([isbn]);
    });

    return {
      serviceName,
      checkCache: (isbn: string) => cacher.checkCache(isbn),
      query: reported,
      saveCache: () => { if (cacheData) cacheData[serviceName] = cacher.saveCache(savers); },
    };
  });
  return {
    editionsOfs,
    abortAll: () => {
      limit.clearQueue(); // leaves un-started calls as unsettled Promises
      limitAbort(); // rejects Promise that is raced against limited Promise (especially those that will remain unsettled)
      olThrottle(() => void 0).abort();
      ltThrottle(() => void 0).abort();
    },
  };
}

export type ProgressReport =
  | { event: 'service cache hit', service: EditionsService, isbn: string }
  | { event: 'query plan', plan: Map<EditionsService, Set<string>> }
  | { event: 'service query started', service: EditionsService, isbn: string }
  | { event: 'service query finished', service: EditionsService, isbn: string, isbns: Set<string>, warnings: ContentError[], faults: ContentError[] }
  | { event: 'rejection', reason: any } // eslint-disable-line @typescript-eslint/no-explicit-any
  | { event: 'fetch started', service: EditionsService, url: string }
  | { event: 'fetch finished', service: EditionsService, url: string, elapsed: number }
  | { event: 'abort fn', fn: () => void };
export type ProgressReporter = (report: ProgressReport) => void;
