import * as t from 'typanion';
import { equivalentISBNs } from './isbn.js';

export type CacheablePromisor<A, R> = (arg: A) => Promise<R>;

type SavedCache<A, R> = [A, R][];

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
 */
export function cachePromisor<A, R>(
  fn: CacheablePromisor<A, R>,
  saved?: {
    isArgument: t.StrictValidator<unknown, A>,
    isResolvesTo: t.StrictValidator<unknown, R>,
    cache: SavedCache<A, R>
  }): CacheablePromisor<A, R> & { saveCache(): SavedCache<A, R> } {

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
 */
export function cacheEditionsPromisor(
  fn: CacheablePromisor<string, Set<string>>,
  saved?: SavedCache<string, Set<string>>)
  : CacheablePromisor<string, Set<string>> & { saveCache(): SavedCache<string, Set<string>> } {

  const transformedCache = new Map<string, Set<string>>;

  const newfn = _cachePromisor(
    fn,
    saved ? { isArgument: t.isString(), isResolvesTo: t.isSet(t.isString()), cache: saved } : void 0,
    {
      getCacheKey: (arg: string) =>
        equivalentISBNs(arg)[0],
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
  getCacheKey?(arg: A): A
  getCachedResolution(cachedKey: A): CacheCheck<R>,
  transformResolution(cacheKey: A, resolution: R): R
  cacheResolution(cacheKey: A, resolution: R): void,
}

// the overridable caching wrapper
function _cachePromisor<A, R>(
  fn: CacheablePromisor<A, R>,
  saved?: {
    isArgument: t.StrictValidator<unknown, A>,
    isResolvesTo: t.StrictValidator<unknown, R>,
    cache: SavedCache<A, R>
  },
  overrides?: CachedPromisorOverrides<A, R>
): CacheablePromisor<A, R> & { saveCache(): SavedCache<A, R> } {

  // cache of "raw" argument -> "raw" resolution
  let cache: Map<A, R>;

  // restore cache from saved, or start empty
  if (saved) {

    const validation = t.as(
      saved.cache,
      t.isArray(t.isTuple([saved.isArgument, saved.isResolvesTo])),
      { errors: true });

    if (!validation.errors)
      cache = new Map(validation.value);
    else
      throw `invalid saved.cache: ${validation.errors.join('; ')}`;

  }
  else cache = new Map;

  // override helpers
  const getCacheKey = (arg: A): A =>
    overrides?.getCacheKey?.(arg) ?? arg;
  const getCachedResolution = (arg: A, cacheKey: A): CacheCheck<R> =>
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
  const newfn = (arg: A): Promise<R> => {

    const cacheKey = getCacheKey(arg);

    // check the pending cache, the override's cache, and the "raw" cache
    {
      const pendingPromise = getCached(cacheKey, pending);
      if (pendingPromise.hit) return pendingPromise.value;
      let cached: CacheCheck<R>;
      cached = getCachedResolution(arg, cacheKey);
      if (cached.hit) return Promise.resolve(cached.value);
      cached = getCached(arg, cache);
      if (cached.hit) return Promise.resolve(cached.value);
    }

    // call the wrapped function
    const promise = fn(arg)
      .then(resolution => {
        // cache the "raw" call result
        cache.set(arg, resolution);

        // let the override transform and cache the result
        const transformed = transformResolution(cacheKey, resolution);
        cacheResolution(cacheKey, transformed);

        // give the transformed value as the result of the overall cache call
        return transformed;
      });

    // give the unsettled Promise to subsequent callers until it settles
    pending.set(cacheKey, promise);
    promise.finally(() => pending.delete(cacheKey)).catch(/* swallow unhandled rejection */() => void 0);

    return promise;
  };

  // export cached calls for possible persistence
  newfn.saveCache = () => [...cache.entries()];

  return newfn;
}
