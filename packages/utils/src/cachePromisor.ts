import * as t from 'typanion';

export type CacheablePromisor<A, R> = (arg: A) => Promise<R>;

type SavedCache<A, R> = [A, R][];

export function cachePromisor<A, R>(
  fn: CacheablePromisor<A, R>,
  saved?: {
    isArgument: t.StrictValidator<unknown, A>,
    isResolvesTo: t.StrictValidator<unknown, R>,
    cache: SavedCache<A, R>
  }): CacheablePromisor<A, R> & { saveCache(): SavedCache<A, R> } {

  let cache: Map<A, R>;
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

  const pending = new Map<A, Promise<R>>;

  const newfn = (arg: A) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (cache.has(arg)) { return Promise.resolve(cache.get(arg)!) }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (pending.has(arg)) { return pending.get(arg)! }

    const promise = fn(arg);

    promise.then(value => {

      cache.set(arg, value);
      pending.delete(arg);

    }, () => {

      pending.delete(arg);

    });

    pending.set(arg, promise);

    return promise;
  };

  newfn.saveCache = () => [...cache.entries()];

  return newfn;
}
