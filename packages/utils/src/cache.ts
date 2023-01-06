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
};

export type SavedCache<A, R> = [argument: A, resolution: R][];

const taggedV1 = <A, R>(t: [A, R]): [argument: A, resolution: R] => t;
const v1 = <A, R>(a: t.StrictValidator<unknown, A>, r: t.StrictValidator<unknown, R>) => t.isArray(t.isTuple(taggedV1([a, r])));
const isRestorableV1 = v1(t.isUnknown(), t.isUnknown());

export const isRestorable = t.isOneOf([isRestorableV1]); // update SavedCache be non-unknown formulation of latest version's type!

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
  import: t.InferType<typeof isRestorable>,
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
  fn: CacheablePromisor<A, R | CacheControl<R>>,
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
  fn: CacheablePromisor<string, Set<string> | CacheControl<Set<string>>>,
  saved?: ImportCacheOptions<string, Set<string>>)
  : CachedPromisor<string, Set<string>> {

  const transformedCache = new Map<string, Set<string>>;

  const newfn = _cachePromisor(
    fn,
    saved,
    {
      getCacheKey: (argument: string) =>
        equivalentISBNs(argument)[0],
      getCachedResolution: (cacheKey: string) =>
        getCached(cacheKey, transformedCache),
      transformResolution: (cacheKey: string, resolution: Set<string>): Set<string> => {
        const normalized = Array.from(resolution, isbn => equivalentISBNs(isbn)[0]);
        normalized.push(cacheKey);
        const isbns = new Set(normalized.reduce(
          (isbns, isbn) => isbns.concat(Array.from(transformedCache.get(isbn) ?? [])),
          Array.from(normalized))
          .sort());
        return isbns;
      },
      cacheResolution: (cacheKey: string, resolution: Set<string>) =>
        resolution.forEach(isbn => transformedCache.set(isbn, resolution)),
    });
  return newfn;
}

export class CacheControl<T> {
  constructor(public value: T, public disposition: 'cache' | 'do not cache') { }
}

// cache lookup helpers
type CacheCheck<T> = { hit: true, value: T } | { hit: false, value: undefined };
function hit<T>(value: T): CacheCheck<T> { return { hit: true, value } }
function miss<T>(): CacheCheck<T> { return { hit: false, value: void 0 } }
function getCached<K, T>(key: K, cache: Map<K, T>): CacheCheck<T> {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (cache.has(key)) return hit(cache.get(key)!);
  else return miss();
}

// Overrides for the cache
//
// `getCacheKey` is optional, but it is only ever used in conjunction with the
// other override functions, so it does not make sense to use it by itself (the
// base cache only deals with the "raw" argument, so it would not affect
// anything).
//
// If you want to `transformResolution`, then you really need to
// `getCachedResolution` and `cacheResolution`, too. If the override does not
// cache its own transformed resolutions, then the only the initial "cache miss"
// result will be transformed (the base cache will answer subsequent "cache hit"
// calls with the "raw" resolution).
//
interface CachedPromisorOverrides<A, R> {
  getCacheKey?(argument: A): A
  getCachedResolution(cachedKey: A): CacheCheck<R>,
  transformResolution(cacheKey: A, resolution: R): R
  cacheResolution(cacheKey: A, resolution: R): void,
}

// the overridable caching wrapper
function _cachePromisor<A, R>(
  fn: CacheablePromisor<A, R | CacheControl<R>>,
  saved?: ImportCacheOptions<A, R>,
  overrides?: CachedPromisorOverrides<A, R>
): CachedPromisor<A, R> {

  // cache of "raw" argument -> "raw" resolution
  let cache: Map<A, R>;

  // restore cache from saved, or start empty
  if (!saved)
    cache = new Map;
  else if ('import' in saved) {
    if (isRestorableV1(saved.import))
      cache = new Map(saved.import.flatMap(([arg, res]) => {
        try { return [[saved.restoreArgument(arg), saved.restoreResolution(res)]] }
        catch { return [] }
      }));
    else
      throw 'saved.import does not match any recognized format';
  }
  else cache = new Map(saved);

  // override helpers
  const getCacheKey = (argument: A): A =>
    overrides?.getCacheKey?.(argument) ?? argument;
  const getCachedResolution = (argument: A, cacheKey: A): CacheCheck<R> =>
    overrides?.getCachedResolution(cacheKey) ?? miss();
  const transformResolution = (cacheKey: A, resolution: R): R =>
    overrides?.transformResolution(cacheKey, resolution) ?? resolution;
  const cacheResolution = (cacheKey: A, resolution: R): void =>
    overrides?.cacheResolution(cacheKey, resolution);

  // let override rebuild its own cache from the "raw" one
  cache.forEach((resolution, arg) => {
    const cacheKey = getCacheKey(arg);
    cacheResolution(cacheKey, transformResolution(cacheKey, resolution));
  });

  // cache of cacheKey -> unsettled Promise
  // keyed by the cacheKey since there is no override for the pending cache
  const pending: Map<A, Promise<R>> = new Map;

  // the caching wrapper function
  const newfn = (argument: A): Promise<R> => {

    const cacheKey = getCacheKey(argument);

    // check the pending cache, the override's cache, and the "raw" cache
    {
      const pendingPromise = getCached(cacheKey, pending);
      if (pendingPromise.hit) return pendingPromise.value;
      let cached: CacheCheck<R>;
      cached = getCachedResolution(argument, cacheKey);
      if (cached.hit) return Promise.resolve(cached.value);
      cached = getCached(argument, cache);
      if (cached.hit) return Promise.resolve(cached.value);
    }

    // call the wrapped function
    const promise = fn(argument)
      .then(cacheControlOrResolution => {

        const { resolution, shouldCache } = ((ccOrR) =>
          ccOrR instanceof CacheControl
            ? { resolution: ccOrR.value, shouldCache: ccOrR.disposition === 'cache' }
            : { resolution: ccOrR, shouldCache: true }
        )(cacheControlOrResolution);

        // cache the "raw" call result
        if (shouldCache) cache.set(argument, resolution);

        // let the override transform
        const transformed = transformResolution(cacheKey, resolution);

        // let override cache the result
        if (shouldCache) cacheResolution(cacheKey, transformed);

        // give the transformed value as the result of the overall cache call
        return transformed;
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
      return [...cache.entries()];
    else
      return [...cache.entries()].map(([arg, res]) =>
        [
          marshalling.saveArgument(arg),
          marshalling.saveResolution(res)
        ]);
  }

  newfn.saveCache = saveCache;

  return newfn;
}
