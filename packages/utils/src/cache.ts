import * as t from 'typanion';
import { equivalentISBNs } from './isbn.js';

export type CacheablePromisor<A, R> = (argument: A) => Promise<R>;
export type CachedPromisor<A, R> = ((argument: A) => Promise<R>) & {
  /**
   * Export the cached calls (for later import into another cache).
   *
   * If not marshalled (no argument provided), the result will be
   * `JSON.stringify`-able if the `A` and `R` types are `JSON.stringify`-able.
   *
   * If marshalled (marshalling argument provided), the result will be
   * `JSON.stringify`-able if the converted types are `JSON.stringify`-able.
   *
   * `saveArgument` is used to convert each cached argument, and
   * `saveResolution` is used to convert each cached resolution. The converted
   * types can be whatever is convenient for your saving, persistence, or
   * transportation needs (e.g. `JSON.stringify`).
   *
   * These conversions can be handy if the argument or resolution types are not
   * directly serializable in the data format you will be using (e.g. a `Set` is
   * not usefully `JSON.stringify`-able).
   *
   */
  saveCache(): SavedCache<A, R>,
  saveCache<As, Rs>(marshalling: {
    saveArgument: (argument: A) => As,
    saveResolution: (resolution: R) => Rs,
  }): SavedCache<As, Rs>,
  /**
   * Check for a previously cached resolution.
   *
   * Note: Unlike normal calls through the cache, this function is synchronous
   * and does not check for "in flight" calls (those that have started, but not
   * yet resolved).
   *
   */
  checkCache(argument: A): CacheCheck<R>,
};

export type SavedCache<A, R> = { version: 2, data: [argument: A, resolution: R, expiration: number][] };

const taggedV1 = <A, R>(t: [A, R]): [argument: A, resolution: R] => t;
const isRestorableV1 = t.isArray(t.isTuple(taggedV1([t.isUnknown(), t.isUnknown()])));

const taggedV2 = <A, R, E>(t: [A, R, E]): [argument: A, resolution: R, expiration: E] => t;
const isRestorableV2 = t.isObject({
  version: t.isLiteral(2),
  data: t.isArray(t.isTuple(taggedV2([t.isUnknown(), t.isUnknown(), t.isNumber()]))),
});

/**
 * These options control how the provided data is imported to populate the new
 * cache.
 *
 * The output of `saveCache()` (without the marshalling argument) is
 * `SavedCache<A,R>` and can be directly imported when creating a newly cached
 * function (assuming the argument and resolution types are the same).
 *
 * If `saveCache` was previously given a marshaling argument, its output was
 * `SavedCache<As,Rs>` (where `As` and `Rs` were specified by the user-provided
 * marshalling functions). Such input will need to be unmarshalled before it can
 * be imported as a new cache for the original function. Pass the previously
 * saved value as the `import` property and appropriate unmarshalling functions
 * for the `restoreArgument` and `restoreResolution` properties.
 */
export type ImportCacheOptions<A, R> = SavedCache<A, R> | {
  import?: unknown,
  restoreArgument: (savedArgument: unknown) => A,
  restoreResolution: (savedResolution: unknown) => R,
};

/**
 * Wrap unary `async`/`Promise`-returning `fn` with a cache.
 *
 * When the returned function is called with a particular value of its argument
 * for the first time it calls `fn` to provide the resolution value. Subsequent
 * calls with that same argument value will return the cached resolution value
 * instead of running `fn` again.
 *
 * The cache is a `Map` keyed with the argument, so "the same argument value"
 * means whatever `Map` considers to be the same key value (basically `===`).
 *
 * If the function returns `CacheControl` instances, they will control whether
 * the resolutions are cached. Otherwise, all resolutions will be cached.
 */
export function cachePromisor<A, R>(
  fn: CacheablePromisor<A, CacheControl<R>> | { fn: CacheablePromisor<A, R>, cacheForMillis: number },
  saved?: ImportCacheOptions<A, R>
): CachedPromisor<A, R> {

  return _cachePromisor(fn, saved);
}

/**
 * Wrap "ISBNs of work's other editions" `(isbn:string)=>Set<string>` function
 * with a cache.
 *
 * The `isbn` argument is normalized (no spaces or hyphens, attempted conversion
 * to ISBN-13), so equivalent variations of an ISBN will hit the cache after any
 * one variation has been previously called.
 *
 * Also, once resolved the resolved `Set` is modified in several ways:
 * - the ISBNs are normalized
 * - the normalized `isbn` argument is itself added to the result set so that
 *   the "editions of" relation is reflexive.
 * - the previously cached ISBNs of any of the current resolution's ISBNs are
 *   combined together so that the "editions of" relation is transitive.
 * - the combined result is cached under each ISBN so that the "editions of"
 *   relation is symmetric.
 *
 * See `cachePromisor` for more details.
 */
export function cacheEditionsPromisor(
  fn: CacheablePromisor<string, CacheControl<Set<string>>> | { fn: CacheablePromisor<string, Set<string>>, cacheForMillis: number },
  saved?: ImportCacheOptions<string, Set<string>>)
  : CachedPromisor<string, Set<string>> {

  // contributorsOf: key->values entry means each of values lists key in its "raw" resolution
  const contributorsOf = new Map<string, Set<string>>;
  // transformedCache: cache of (possibly) merged resolutions; if merged, expiration is the earliest of contributing resolutions
  const transformedCache = new Map<string, { resolution: Set<string>, expiration: number }>;

  const newfn = _cachePromisor(
    fn,
    saved,
    {
      getCacheKey: (argument: string) =>
        equivalentISBNs(argument)[0],
      getCachedResolution: (cacheKey: string) => {
        const cached = getCached(cacheKey, transformedCache);
        if (cached.hit && Date.now() < cached.value.expiration)
          return hit(cached.value.resolution);
        return miss();
      },
      transformResolution: (cacheKey: string, resolution: Set<string>, expiration: number, getCachedWithExpiration): { resolution: Set<string>, expiration: number } => {
        // remove cacheKey from contributorsOf
        {
          // prevents other queries merging this cacheKey's new resolution due
          // to some old value that this cacheKey no longer includes
          (() => {
            const previousCached = getCachedWithExpiration(cacheKey);
            if (previousCached.hit)
              return normalize(cacheKey, previousCached.value.resolution);
            return [];
          })().forEach(isbn => contributorsOf.get(isbn)?.delete(cacheKey));
        }

        // normalize the new resolution values
        const normalized = new Set(normalize(cacheKey, resolution));

        // add cacheKey as contributor to each of normalized
        // also, collect other contributors to each of normalized
        const contributors = new Set<string>;
        normalized.forEach(isbn => {
          const otherContributors = contributorsOf.get(isbn);
          if (otherContributors) {
            otherContributors.add(cacheKey);
            otherContributors.forEach(c => contributors.add(c));
          } else {
            const newContributors = new Set([cacheKey]);
            contributorsOf.set(isbn, newContributors);
            contributors.add(cacheKey);
          }
        });
        // skip the current cacheKey, since we will being with its contribution
        contributors.delete(cacheKey);

        const now = Date.now();
        return Array.from(contributors).reduce(({ resolution, expiration }, contributor) => {
          const cached = getCachedWithExpiration(contributor);
          if (cached.hit)
            if (now < cached.value.expiration) {
              normalize(contributor, cached.value.resolution).forEach(isbn => resolution.add(isbn));
              return { resolution, expiration: Math.min(expiration, cached.value.expiration) };
            }
          return { resolution, expiration };
        }, { resolution: normalized, expiration });

        function normalize(cacheKey: string, resolution: Iterable<string>): string[] {
          const normalized = Array.from(resolution, isbn => equivalentISBNs(isbn)[0]);
          normalized.push(cacheKey);
          return normalized;
        }
      },
      cacheResolution: (cacheKey: string, { resolution, expiration }: { resolution: Set<string>, expiration: number }) =>
        resolution.forEach(isbn => transformedCache.set(isbn, { resolution, expiration })),
    });
  return newfn;
}

export class CacheControl<T> {
  public expiration = 0; // already expired; surely?
  constructor(public value: T, disposition: { forMillis: number } | { until: Date } | 'do not cache') {
    if (typeof disposition == 'object')
      if ('until' in disposition)
        this.expiration = disposition.until.valueOf();
      else if ('forMillis' in disposition)
        this.expiration = Date.now() + disposition.forMillis;
  }
}

export type MaybeCacheControl<T> = T | CacheControl<T>;

// cache lookup helpers
export type CacheCheck<T> = { hit: true, value: T } | { hit: false, value: undefined };
function hit<T>(value: T): CacheCheck<T> { return { hit: true, value } }
function miss<T>(): CacheCheck<T> { return { hit: false, value: void 0 } }
function getCached<K, T>(key: K, cache: Map<K, T>): CacheCheck<T> {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (cache.has(key)) return hit(cache.get(key)!);
  else return miss();
}

// Overrides for the cache
//
// If `getCacheKey` is given, its return value is used as the key in all the
// internal caches (pending and resolved, the later of which is accessible
// through `getCachedWithExpiration` in `transformResolution`).
//
// `getCachedResolution` is necessary if you want to be able to answer for
// arguments (transformed into `cacheKey`) that have not previously been
// processed by the wrapped function. In that case, you will probably also need
// `cacheResolution` (the internal cache only records the "raw" resolution under
// the `cacheKey`).
//
// In `transformResolution`, `getCachedWithExpiration` can be used to access the
// internal cache of "raw" resolutions (including the previous resolution of the
// current `cacheKey`).
//
interface CachedPromisorOverrides<A, R> {
  getCacheKey?(argument: A): A
  getCachedResolution?(cachedKey: A): CacheCheck<R>,
  transformResolution?(cacheKey: A, resolution: R, expiration: number, getCachedWithExpiration: (argument: A) => CacheCheck<{ resolution: R, expiration: number }>): { resolution: R, expiration: number }
  cacheResolution?(cacheKey: A, transformed: { resolution: R, expiration: number }): void,
}

// the overridable caching wrapper
function _cachePromisor<A, R>(
  fn: CacheablePromisor<A, CacheControl<R>> | { fn: CacheablePromisor<A, R>, cacheForMillis: number },
  saved?: ImportCacheOptions<A, R>,
  overrides?: CachedPromisorOverrides<A, R>
): CachedPromisor<A, R> {

  const defaultCacheDuration = 30 * 24 * 60 * 60 * 1000;

  // cache of cacheKey (possibly transformed argument) -> "raw" resolution
  let cache: Map<A, { resolution: R, expiration: number }>;

  // restore cache from saved, or start empty
  if (!saved)
    cache = new Map;
  else if ('restoreArgument' in saved) {
    if (!saved.import)
      cache = new Map;
    else if (isRestorableV1(saved.import))
      cache = new Map(saved.import.flatMap(([arg, res]): [A, R][] => {
        try { return [[saved.restoreArgument(arg), saved.restoreResolution(res)]] }
        catch { return [] }
      }).map(([arg, res]) => [arg, { resolution: res, expiration: Date.now() + defaultCacheDuration }]));
    else if (isRestorableV2(saved.import))
      cache = new Map(saved.import.data.flatMap(([arg, res, exp]) => {
        try { return [[saved.restoreArgument(arg), { resolution: saved.restoreResolution(res), expiration: exp }]] }
        catch { return [] }
      }));
    else
      throw 'saved.import does not match any recognized format';
  }
  else cache = new Map(saved.data.map(([arg, res, exp]) => [arg, { resolution: res, expiration: exp }]));

  // override helpers
  const getCacheKey = (argument: A) =>
    overrides?.getCacheKey?.(argument) ?? argument;
  const getCachedResolution = (cacheKey: A) =>
    overrides?.getCachedResolution?.(cacheKey) ?? miss();
  const transformResolution = (cacheKey: A, resolution: R, expiration: number) =>
    overrides?.transformResolution?.(cacheKey, resolution, expiration, (cacheKey: A) => getCached(cacheKey, cache)) ?? { resolution, expiration };
  const cacheResolution = (cacheKey: A, transformed: { resolution: R, expiration: number }) =>
    overrides?.cacheResolution?.(cacheKey, transformed);
  function checkCachedResolution(cacheKey: A): CacheCheck<R> {
    {
      const cached = getCachedResolution(cacheKey);
      if (cached.hit) return cached;
    }
    {
      const cached = getCached(cacheKey, cache);
      const now = Date.now();
      if (cached.hit && now < cached.value.expiration) {
        const transformed = transformResolution(cacheKey, cached.value.resolution, cached.value.expiration);
        if (now < transformed.expiration) {
          cacheResolution(cacheKey, transformed);
          return hit(transformed.resolution);
        }
      }
    }
    return miss();
  }

  // delete expired entries
  // let override rebuild its own cache from the "raw" one
  const now = Date.now();
  cache.forEach(({ resolution, expiration }, cacheKey) => {
    if (now < expiration)
      cacheResolution(cacheKey, transformResolution(cacheKey, resolution, expiration));
    else
      cache.delete(cacheKey);
  });

  // cache of cacheKey -> unsettled Promise
  const pending: Map<A, Promise<R>> = new Map;

  const ccfn = 'cacheForMillis' in fn
    ? (argument: A): Promise<CacheControl<R>> =>
      fn.fn(argument).then(resolution => new CacheControl(resolution, { forMillis: fn.cacheForMillis }))
    : fn;

  // the caching wrapper function
  const newfn = (argument: A): Promise<R> => {

    const cacheKey = getCacheKey(argument);

    // check the pending cache, the override's cache, and the "raw" cache
    {
      const pendingPromise = getCached(cacheKey, pending);
      if (pendingPromise.hit) return pendingPromise.value;
      const cached = checkCachedResolution(cacheKey);
      if (cached.hit) return Promise.resolve(cached.value);
    }

    // call the wrapped function
    const promise = ccfn(argument)
      .then(({ value: resolution, expiration }) => {

        const shouldCache = Date.now() < expiration;

        // let the override transform
        const transformed = transformResolution(cacheKey, resolution, expiration);

        // cache the "raw" call result
        if (shouldCache) cache.set(cacheKey, { resolution, expiration });

        // let override cache the result
        if (shouldCache) cacheResolution(cacheKey, transformed);

        // give the transformed value as the result of the overall cache call
        return transformed.resolution;
      });

    // give the unsettled Promise to subsequent callers until it settles
    pending.set(cacheKey, promise);
    promise.finally(() => pending.delete(cacheKey)).catch(/* swallow unhandled rejection */() => void 0);

    return promise;
  };

  // export cached calls for possible persistence
  function saveCache<As, Rs>(marshalling?: {
    saveArgument: (argument: A) => As,
    saveResolution: (resolution: R) => Rs,
  }): SavedCache<As, Rs> | SavedCache<A, R> {
    if (!marshalling)
      return {
        version: 2,
        data: Array.from(cache.entries()).map(([arg, { resolution: res, expiration: exp }]) =>
          [arg, res, exp])
      };
    else
      return {
        version: 2,
        data: Array.from(cache.entries()).map(([arg, { resolution: res, expiration: exp }]) => [
          marshalling.saveArgument(arg),
          marshalling.saveResolution(res),
          exp,
        ])
      };
  }

  // check for cached resolution
  function checkCache(argument: A): CacheCheck<R> {
    return checkCachedResolution(getCacheKey(argument));
  }

  newfn.saveCache = saveCache;
  newfn.checkCache = checkCache;

  return newfn;
}
