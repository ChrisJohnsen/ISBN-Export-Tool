import { describe, test, expect, jest } from '@jest/globals';
import { CacheControl, cacheEditionsPromisor, cachePromisor } from 'utils';
import * as t from 'typanion';

describe('cachePromisor', () => {
  test('cache miss', async () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    const cached = cachePromisor(fn);

    await expect(cached('one')).resolves.toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
    await expect(cached('two')).resolves.toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('cache hit resolved', async () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4);

    const cached = cachePromisor(fn);

    await expect(cached('three')).resolves.toBe(3);
    await expect(cached('three')).resolves.toBe(3);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('pending hit', async () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(6);

    const cached = cachePromisor(fn);

    const first = cached('five');
    const second = cached('five');

    expect(fn).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toBe(5);
    expect(second).toBe(first);
  });

  test('pending hit, gated', async () => {
    const { withhold, releaseHold } = hold();
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockReturnValueOnce(withhold.then(() => 7))
      .mockReturnValueOnce(withhold.then(() => 8));

    const cached = cachePromisor(fn);

    const first = cached('seven');

    expect(fn).toHaveBeenCalledTimes(1);
    await expect(allUnresolved([first])).resolves.toBeTruthy();

    await new Promise(r => setTimeout(r, 0));
    const second = cached('seven');

    await expect(allUnresolved([first, second])).resolves.toBeTruthy();

    releaseHold();

    expect(fn).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toBe(7);
    expect(second).toBe(first);
  });

  test('pending reject used until resolved', async () => {
    const { withhold, releaseHold } = hold();
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockReturnValueOnce(withhold.then(() => { throw 9 }))
      .mockResolvedValue(10);

    const cached = cachePromisor(fn);

    const first = cached('nine');

    expect(fn).toHaveBeenCalledTimes(1);
    await expect(allUnresolved([first])).resolves.toBeTruthy();

    await new Promise(r => setTimeout(r, 0));
    const second = cached('nine');

    await expect(allUnresolved([first, second])).resolves.toBeTruthy();

    releaseHold();

    expect(fn).toHaveBeenCalledTimes(1);
    await expect(first).rejects.toBe(9);
    expect(second).toBe(first);
  });

  test('does not cache reject', async () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockRejectedValueOnce(11)
      .mockResolvedValue(12);

    const cached = cachePromisor(fn);

    const first = cached('eleven');

    expect(fn).toHaveBeenCalledTimes(1);
    await expect(first).rejects.toBe(11);

    const second = cached('twelve');

    expect(fn).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toBe(12);
  });

  test('rethrows thrown', async () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockImplementation(() => { throw '13' });

    const cached = cachePromisor(fn);

    expect(() => cached('thirteen')).toThrow('13');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('throws if returns non-Promise', () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockReturnValueOnce(14 as unknown as Promise<number>);

    const cached = cachePromisor(fn);

    expect(() => cached('fourteen')).toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('saveCache() returns something', async () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockResolvedValueOnce(15);

    const cached = cachePromisor(fn);

    await expect(cached('fifteen')).resolves.toBe(15);

    const saved = cached.saveCache();

    expect(saved).toEqual(expect.anything());
  });

  test('saveCache() return is loadable and hits after loaded', async () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockResolvedValueOnce(16)
      .mockResolvedValueOnce(17);

    const cached = cachePromisor(fn);

    await expect(cached('sixteen')).resolves.toBe(16);

    const reCached = cachePromisor(fn, cached.saveCache());

    await expect(cached('sixteen')).resolves.toBe(16);
    await expect(reCached('sixteen')).resolves.toBe(16);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('saveCache() marshalling and restore unmarshalling', async () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockResolvedValueOnce(18)
      .mockResolvedValueOnce(19);

    const cached = cachePromisor(fn);

    await expect(cached('eighteen')).resolves.toBe(18);

    const reCached = cachePromisor(fn, {
      restoreArgument: (arg: unknown): string => t.as(arg, t.isString(), { throw: true }).slice(1, -1),
      restoreResolution: (resolution: unknown): number => parseInt(t.as(resolution, t.isString(), { throw: true })),
      import: cached.saveCache({
        saveArgument: (arg: string): string => `X${arg}X`,
        saveResolution: (resolution: number): string => `${resolution}`,
      }),
    });

    await expect(cached('eighteen')).resolves.toBe(18);
    await expect(reCached('eighteen')).resolves.toBe(18);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('cache control', async () => {
    const fn = jest.fn<(arg: string) => Promise<CacheControl<number>>>()
      .mockResolvedValueOnce(new CacheControl(20, 'do not cache'))
      .mockResolvedValueOnce(new CacheControl(20.5, 'cache'))
      .mockResolvedValueOnce(new CacheControl(21, 'do not cache'));

    const cached = cachePromisor(fn);

    await expect(cached('twenty')).resolves.toBe(20);
    expect(fn).toHaveBeenCalledTimes(1);
    await expect(cached('twenty')).resolves.toBe(20.5);
    await expect(cached('twenty')).resolves.toBe(20.5);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('cacheEditionsPromisor', () => {
  test('equivalent ISBN: pending hit, gated; cache hit', async () => {
    const { withhold, releaseHold } = hold();
    const fn = jest.fn<(isbn: string) => Promise<Set<string>>>()
      .mockReturnValueOnce(withhold.then(() => new Set(['1', '2'])));

    const cached = cacheEditionsPromisor(fn);

    const first = cached('1 5384-2424 X');

    expect(fn).toHaveBeenCalledTimes(1);
    await expect(allUnresolved([first])).resolves.toBeTruthy();

    await new Promise(r => setTimeout(r, 0));
    const second = cached('9781538424247');

    await expect(allUnresolved([first, second])).resolves.toBeTruthy();

    releaseHold();
    await new Promise(r => setTimeout(r, 0));
    const third = cached('978-1-5384-2424-7');
    const fourth = cached('153842424X');

    expect(second).toBe(first);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenNthCalledWith(1, '1 5384-2424 X');
    // after initial resolution, each call gets a new Promise
    expect(third).not.toBe(second);
    expect(fourth).not.toBe(third);
  });

  test('normalized result ISBNs', async () => {
    const fn = jest.fn<(isbn: string) => Promise<Set<string>>>()
      .mockResolvedValueOnce(new Set(['0765392763', '978-0-7653-9277-0']));

    const cached = cacheEditionsPromisor(fn);

    const result = await cached('0 7653 9276 3');

    expect(result).toContain('9780765392763');
    expect(result).toContain('9780765392770');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenNthCalledWith(1, '0 7653 9276 3');
  });

  test('"reflexive": result contains (normalized) query', async () => {
    const fn = jest.fn<(isbn: string) => Promise<Set<string>>>()
      .mockResolvedValueOnce(new Set(['1', '2']));

    const cached = cacheEditionsPromisor(fn);

    await expect(cached('1 5384-2424 X')).resolves.toContain('9781538424247');
    await expect(cached('153842424X')).resolves.toContain('9781538424247');
    await expect(cached('978-1-5384-2424-7')).resolves.toContain('9781538424247');
    await expect(cached('9781538424247')).resolves.toContain('9781538424247');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenNthCalledWith(1, '1 5384-2424 X');
  });

  test('"symmetric & transitive": calling with equivalent to a result element gives same response', async () => {
    const fn = jest.fn<(isbn: string) => Promise<Set<string>>>()
      .mockResolvedValueOnce(new Set(['1', '2', '0765392763', '9780765392770']));

    const cached = cacheEditionsPromisor(fn);

    const expected = new Set(['1', '2', '9780765392770', '9780765392763', '9781538424247']);

    await expect(cached('1 5384-2424 X')).resolves.toStrictEqual(expected);
    // symmetric & transitive: (equivalent to) element of cached result, but not previously directly queried
    await expect(cached('0765392763')).resolves.toStrictEqual(expected);
    await expect(cached('978 076539276 3')).resolves.toStrictEqual(expected);
    await expect(cached('0-76539277-1')).resolves.toStrictEqual(expected);
    await expect(cached('978-0-7653-9277-0')).resolves.toStrictEqual(expected);
    // non-ISBN elements in original response
    await expect(cached('1')).resolves.toStrictEqual(expected);
    await expect(cached('2')).resolves.toStrictEqual(expected);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenNthCalledWith(1, '1 5384-2424 X');
  });

  test('cross-query "symmetry & transitivity"', async () => {
    const fn = jest.fn<(isbn: string) => Promise<Set<string>>>()
      .mockResolvedValueOnce(new Set(['0765392763', '9780765392770']))  // {a,b}
      .mockResolvedValueOnce(new Set(['0-7653-9278-X']))                // {d}
      .mockResolvedValueOnce(new Set(['0765392763', '153842424X']));    // {a,c}

    const cached = cacheEditionsPromisor(fn);

    const ab = new Set(['9780765392770', '9780765392763']);

    // initial query: a->{a,b} cached as a -> {a,b} and b -> {a,b}
    await expect(cached('0765392763')).resolves.toStrictEqual(ab);
    await expect(cached('978 076539276 3')).resolves.toStrictEqual(ab);
    await expect(cached('978-0-7653-9277-0')).resolves.toStrictEqual(ab);
    await expect(cached('0-76539277-1')).resolves.toStrictEqual(ab);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenNthCalledWith(1, '0765392763');

    const cd = new Set(['9781538424247', '9780765392787']);

    // next query: c->{d} cached as c->{c,d} and d->{c,d}
    await expect(cached('9781538424247')).resolves.toStrictEqual(cd);
    await expect(cached('1 5384-2424 X')).resolves.toStrictEqual(cd);
    await expect(cached('9780765392787')).resolves.toStrictEqual(cd);
    await expect(cached('0-7653-9278-X')).resolves.toStrictEqual(cd);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(2, '9781538424247');

    const abcde = new Set([...ab, ...cd, '9781786693075']);

    // linking query: e->{a,c}
    await expect(cached('1786693070')).resolves.toStrictEqual(abcde);
    // symmetry & transitivity for the rest, too
    await expect(cached('0765392763')).resolves.toStrictEqual(abcde);
    await expect(cached('978-0 7653-9277 0')).resolves.toStrictEqual(abcde);
    await expect(cached('9781538424247')).resolves.toStrictEqual(abcde);
    await expect(cached('076539278X')).resolves.toStrictEqual(abcde);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn).toHaveBeenNthCalledWith(3, '1786693070');
  });

  test('saved/restored', async () => {
    const fn = jest.fn<(isbn: string) => Promise<Set<string>>>()
      .mockResolvedValueOnce(new Set(['0765392763', '9780765392770', '0-7653-9278-X']));

    const cached = cacheEditionsPromisor(fn);

    const expected = new Set(['9781538424247', '9780765392763', '9780765392770', '9780765392787']);

    // initial query
    await expect(cached('1 5384-2424 X')).resolves.toStrictEqual(expected);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenNthCalledWith(1, '1 5384-2424 X');

    const saved = cached.saveCache();
    const newCached = cacheEditionsPromisor(fn, saved);

    expect(saved).toHaveLength(1); // only "raw" calls (not the derived, ISBN-based relations) are directly saved

    // reflexive over equivalent ISBN
    await expect(newCached('9781538424247')).resolves.toStrictEqual(expected);
    // symmetric over (equivalent) result ISBNs
    await expect(newCached('978 076539276 3')).resolves.toStrictEqual(expected);
    await expect(newCached('0765392763')).resolves.toStrictEqual(expected);
    await expect(newCached('978-0-7653-9277-0')).resolves.toStrictEqual(expected);
    await expect(newCached('0-76539277-1')).resolves.toStrictEqual(expected);
    await expect(newCached('9780765392787')).resolves.toStrictEqual(expected);
    await expect(newCached('0 7653-9278 X')).resolves.toStrictEqual(expected);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

function allUnresolved(promises: Promise<unknown>[]): Promise<boolean> {
  return (async (u) =>
    await Promise.race(promises.concat([Promise.resolve(u)])) === u
  )(Symbol());
}

function hold(): { withhold: Promise<void>; releaseHold: () => void; } {
  let releaseHold: () => void =
    () => { throw 'releaseHold never captured from held Promised' };

  const withhold = new Promise<void>(resolve => releaseHold = resolve);

  return { withhold, releaseHold };
}
