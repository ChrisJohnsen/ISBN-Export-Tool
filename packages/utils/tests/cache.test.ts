import { describe, test, expect, jest, afterEach } from '@jest/globals';
import { CacheControl, cacheEditionsPromisor, cachePromisor } from 'utils';
import * as t from 'typanion';

describe('cachePromisor', () => {
  test('cache miss', async () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    const cached = cachePromisor({ fn, cacheForMillis: 60 * 1000 });

    await expect(cached('one')).resolves.toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
    await expect(cached('two')).resolves.toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('cache hit resolved', async () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4);

    const cached = cachePromisor({ fn, cacheForMillis: 60 * 1000 });

    await expect(cached('three')).resolves.toBe(3);
    await expect(cached('three')).resolves.toBe(3);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('pending hit', async () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(6);

    const cached = cachePromisor({ fn, cacheForMillis: 60 * 1000 });

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

    const cached = cachePromisor({ fn, cacheForMillis: 60 * 1000 });

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

    const cached = cachePromisor({ fn, cacheForMillis: 60 * 1000 });

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

    const cached = cachePromisor({ fn, cacheForMillis: 60 * 1000 });

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

    const cached = cachePromisor({ fn, cacheForMillis: 60 * 1000 });

    expect(() => cached('thirteen')).toThrow('13');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('throws if returns non-Promise', () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockReturnValueOnce(14 as unknown as Promise<number>);

    const cached = cachePromisor({ fn, cacheForMillis: 60 * 1000 });

    expect(() => cached('fourteen')).toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('saveCache() returns something', async () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockResolvedValueOnce(15);

    const cached = cachePromisor({ fn, cacheForMillis: 60 * 1000 });

    await expect(cached('fifteen')).resolves.toBe(15);

    const saved = cached.saveCache();

    expect(saved).toEqual(expect.anything());
  });

  test('saveCache() return is loadable and hits after loaded', async () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockResolvedValueOnce(16)
      .mockResolvedValueOnce(17);

    const cached = cachePromisor({ fn, cacheForMillis: 60 * 1000 });

    await expect(cached('sixteen')).resolves.toBe(16);

    const reCached = cachePromisor({ fn, cacheForMillis: 60 * 1000 }, cached.saveCache());

    await expect(cached('sixteen')).resolves.toBe(16);
    await expect(reCached('sixteen')).resolves.toBe(16);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('saveCache() marshalling and restore unmarshalling', async () => {
    const fn = jest.fn<(arg: string) => Promise<number>>()
      .mockResolvedValueOnce(18)
      .mockResolvedValueOnce(19);

    const cached = cachePromisor({ fn, cacheForMillis: 60 * 1000 });

    await expect(cached('eighteen')).resolves.toBe(18);

    const reCached = cachePromisor({ fn, cacheForMillis: 60 * 1000 }, {
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
      .mockResolvedValueOnce(new CacheControl(20.5, { forMillis: 60 * 1000 }))
      .mockResolvedValueOnce(new CacheControl(21, 'do not cache'));

    const cached = cachePromisor(fn);

    await expect(cached('twenty')).resolves.toBe(20);
    expect(fn).toHaveBeenCalledTimes(1);
    await expect(cached('twenty')).resolves.toBe(20.5);
    await expect(cached('twenty')).resolves.toBe(20.5);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('checkCache', async () => {
    const fn = jest.fn<(arg: string) => Promise<CacheControl<number>>>()
      .mockResolvedValueOnce(new CacheControl(22, 'do not cache'))
      .mockResolvedValueOnce(new CacheControl(22.5, { forMillis: 60 * 1000 }))
      .mockResolvedValueOnce(new CacheControl(23, 'do not cache'));

    const cached = cachePromisor(fn);

    expect(cached.checkCache('twenty two')).toHaveProperty('hit', false);
    await expect(cached('twenty two')).resolves.toBe(22);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(cached.checkCache('twenty two')).toHaveProperty('hit', false);

    await expect(cached('twenty two')).resolves.toBe(22.5);
    expect(cached.checkCache('twenty two')).toStrictEqual({ hit: true, value: 22.5 });
    await expect(cached('twenty two')).resolves.toBe(22.5);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('cachePromisor fake timers', () => {
  afterEach(() => void jest.useRealTimers());

  test('expiration', async () => {

    jest.useFakeTimers();

    const start = Date.now();
    const startPlus = (millis: number) => new Date(start + millis);

    const expirations = [0, 1, 2, 3, 4, 5].map(h => h * 60 * 60 * 1000);

    const fn = jest.fn<(arg: string) => Promise<CacheControl<number>>>()
      .mockResolvedValueOnce(new CacheControl(24, { forMillis: expirations[2] }))
      .mockResolvedValueOnce(new CacheControl(25, { forMillis: expirations[1] }))
      .mockResolvedValueOnce(new CacheControl(26, { until: startPlus(expirations[4]) }))
      .mockResolvedValueOnce(new CacheControl(27, { until: startPlus(expirations[3]) }))
      .mockResolvedValueOnce(new CacheControl(28, 'do not cache'))
      .mockResolvedValueOnce(new CacheControl(29, { forMillis: 10 * 60 * 60 * 1000 }))
      .mockResolvedValueOnce(new CacheControl(30, { forMillis: 1 * 60 * 60 * 1000 }))
      .mockResolvedValueOnce(new CacheControl(31, { forMillis: 10 * 60 * 60 * 1000 }))
      .mockResolvedValueOnce(new CacheControl(31.5, { forMillis: 10 * 60 * 60 * 1000 }));

    const cached = cachePromisor(fn);

    // expirations   1     2     3     4     5
    // A calls  *----------^ *---^ O  *----------> (O is not cached)
    // B calls   *---^ *---------------^ *---^ *->
    // A values 24            27    28 29
    // B values  25    26                30    31{.5}

    await expect(cached('A')).resolves.toBe(24);
    expect(fn).toHaveBeenCalledTimes(1);
    await expect(cached('B')).resolves.toBe(25);
    await expect(cached('A')).resolves.toBe(24);
    await expect(cached('B')).resolves.toBe(25);

    // just before expiration 1
    jest.setSystemTime(startPlus(expirations[1] - 60 * 1000));

    await expect(cached('A')).resolves.toBe(24);
    await expect(cached('B')).resolves.toBe(25);

    // after expiration 1 (B expires)
    jest.setSystemTime(startPlus(expirations[1] + 60 * 1000));

    await expect(cached('A')).resolves.toBe(24);
    expect(cached.checkCache('B')).toHaveProperty('hit', false);
    expect(fn).toHaveBeenCalledTimes(2);
    await expect(cached('B')).resolves.toBe(26);
    await expect(cached('B')).resolves.toBe(26);

    // just before expiration 1
    jest.setSystemTime(startPlus(expirations[2] - 60 * 1000));

    await expect(cached('A')).resolves.toBe(24);
    await expect(cached('B')).resolves.toBe(26);

    // after expiration 2 (A expires)
    jest.setSystemTime(startPlus(expirations[2] + 60 * 1000));

    expect(cached.checkCache('A')).toHaveProperty('hit', false);
    await expect(cached('B')).resolves.toBe(26);
    expect(fn).toHaveBeenCalledTimes(3);
    await expect(cached('A')).resolves.toBe(27);
    await expect(cached('B')).resolves.toBe(26);

    // after expiration 3 (A expires)
    jest.setSystemTime(startPlus(expirations[3] + 60 * 1000));

    expect(cached.checkCache('A')).toHaveProperty('hit', false);
    await expect(cached('B')).resolves.toBe(26);
    expect(fn).toHaveBeenCalledTimes(4);
    await expect(cached('A')).resolves.toBe(28);
    await expect(cached('B')).resolves.toBe(26);
    expect(fn).toHaveBeenCalledTimes(5);
    await expect(cached('A')).resolves.toBe(29);
    await expect(cached('B')).resolves.toBe(26);

    // after expiration 4 (A expires)
    jest.setSystemTime(startPlus(expirations[4] + 60 * 1000));

    await expect(cached('A')).resolves.toBe(29);
    expect(cached.checkCache('B')).toHaveProperty('hit', false);
    expect(fn).toHaveBeenCalledTimes(6);
    await expect(cached('B')).resolves.toBe(30);
    await expect(cached('A')).resolves.toBe(29);

    const earlySave = cached.saveCache();

    // after expiration 5 (B expires)
    jest.setSystemTime(startPlus(expirations[5] + 2 * 60 * 1000));

    const lateSave = cached.saveCache();

    {
      const newCached = cachePromisor(fn, earlySave);

      await expect(newCached('A')).resolves.toBe(29);
      expect(newCached.checkCache('B')).toHaveProperty('hit', false);
      expect(fn).toHaveBeenCalledTimes(7);
      await expect(newCached('B')).resolves.toBe(31);
      expect(fn).toHaveBeenCalledTimes(8);
    }
    {
      const newCached = cachePromisor(fn, lateSave);

      await expect(newCached('A')).resolves.toBe(29);
      expect(newCached.checkCache('B')).toHaveProperty('hit', false);
      expect(fn).toHaveBeenCalledTimes(8);
      await expect(newCached('B')).resolves.toBe(31.5);
      expect(fn).toHaveBeenCalledTimes(9);
    }
  });
});

describe('cacheEditionsPromisor', () => {
  test('equivalent ISBN: pending hit, gated; cache hit', async () => {
    const { withhold, releaseHold } = hold();
    const fn = jest.fn<(isbn: string) => Promise<Set<string>>>()
      .mockReturnValueOnce(withhold.then(() => new Set(['1', '2'])));

    const cached = cacheEditionsPromisor({ fn, cacheForMillis: 60 * 1000 });

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

    const cached = cacheEditionsPromisor({ fn, cacheForMillis: 60 * 1000 });

    const result = await cached('0 7653 9276 3');

    expect(result).toContain('9780765392763');
    expect(result).toContain('9780765392770');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenNthCalledWith(1, '0 7653 9276 3');
  });

  test('"reflexive": result contains (normalized) query', async () => {
    const fn = jest.fn<(isbn: string) => Promise<Set<string>>>()
      .mockResolvedValueOnce(new Set(['1', '2']));

    const cached = cacheEditionsPromisor({ fn, cacheForMillis: 60 * 1000 });

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

    const cached = cacheEditionsPromisor({ fn, cacheForMillis: 60 * 1000 });

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

    const cached = cacheEditionsPromisor({ fn, cacheForMillis: 60 * 1000 });

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

    const cached = cacheEditionsPromisor({ fn, cacheForMillis: 60 * 1000 });

    const expected = new Set(['9781538424247', '9780765392763', '9780765392770', '9780765392787']);

    // initial query
    await expect(cached('1 5384-2424 X')).resolves.toStrictEqual(expected);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenNthCalledWith(1, '1 5384-2424 X');

    const saved = cached.saveCache();
    const newCached = cacheEditionsPromisor({ fn, cacheForMillis: 60 * 1000 }, saved);

    expect(saved.data).toHaveLength(1); // only "raw" calls (not the derived, ISBN-based relations) are directly saved

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

describe('cacheEditionsPromisor fake timers', () => {
  afterEach(() => void jest.useRealTimers());

  test('expiration', async () => {

    jest.useFakeTimers();

    const start = Date.now();
    const startPlus = (millis: number) => new Date(start + millis);

    const expirations = [0, 1, 2, 3].map(h => h * 60 * 60 * 1000);

    const isbns = (isbns =>
    ({
      ...isbns,
      ab: new Set([isbns.a, isbns.b]),
      cd: new Set([isbns.c, isbns.d]),
      ac: new Set([isbns.a, isbns.c]),
      abcde: new Set([isbns.a, isbns.b, isbns.c, isbns.d, isbns.e]),
      ae: new Set([isbns.a, isbns.e]),
      bf: new Set([isbns.b, isbns.f]),
    }))({
      a: '9781538424247',
      b: '9780765392763',
      c: '9780765392770',
      d: '9780765392787',
      e: '9781786693075',
      f: '9781786693051',
    });

    // A->B   until t2 {A,B}->A,B
    // C->D   until t3 {C,D}->C,D {A,B}->A,B
    // E->A,C until t1 {A,B,C,D,E}->A,B,C,D,E
    // t1 (E expires)  E->miss
    // current {A,B}->A,B {C,D}->C,D
    // t2 (A expires)  {A,B}->miss
    // current {C,D}->C,D
    // A->E   until t3 {A,E}->A,E {C,D}->C,D
    // F->B   until t3 {B,F}->B,F {A,E}->A,E {C,D}->C,D

    const fn = jest.fn<(isbn: string) => Promise<CacheControl<Set<string>>>>()
      .mockResolvedValueOnce(new CacheControl(new Set([isbns.b]), { until: startPlus(expirations[2]) }))
      .mockResolvedValueOnce(new CacheControl(new Set([isbns.d]), { until: startPlus(expirations[3]) }))
      .mockResolvedValueOnce(new CacheControl(isbns.ac, { until: startPlus(expirations[1]) }))
      .mockResolvedValueOnce(new CacheControl(new Set([isbns.e]), { until: startPlus(expirations[3]) }))
      .mockResolvedValueOnce(new CacheControl(new Set([isbns.b]), { until: startPlus(expirations[3]) }));

    const cached = cacheEditionsPromisor(fn);

    await expect(cached(isbns.a)).resolves.toStrictEqual(isbns.ab);

    expect(fn).toHaveBeenCalledTimes(1);
    await expect(cached(isbns.c)).resolves.toStrictEqual(isbns.cd);

    await expect(cached(isbns.a)).resolves.toStrictEqual(isbns.ab);
    await expect(cached(isbns.b)).resolves.toStrictEqual(isbns.ab);
    await expect(cached(isbns.c)).resolves.toStrictEqual(isbns.cd);
    await expect(cached(isbns.d)).resolves.toStrictEqual(isbns.cd);

    expect(fn).toHaveBeenCalledTimes(2);
    await expect(cached(isbns.e)).resolves.toStrictEqual(isbns.abcde);

    await expect(cached(isbns.a)).resolves.toStrictEqual(isbns.abcde);
    await expect(cached(isbns.b)).resolves.toStrictEqual(isbns.abcde);
    await expect(cached(isbns.c)).resolves.toStrictEqual(isbns.abcde);
    await expect(cached(isbns.d)).resolves.toStrictEqual(isbns.abcde);

    jest.setSystemTime(startPlus(expirations[1] + 60 * 1000));

    expect(cached.checkCache(isbns.e)).toHaveProperty('hit', false);
    await expect(cached(isbns.a)).resolves.toStrictEqual(isbns.ab);
    await expect(cached(isbns.b)).resolves.toStrictEqual(isbns.ab);
    await expect(cached(isbns.c)).resolves.toStrictEqual(isbns.cd);
    await expect(cached(isbns.d)).resolves.toStrictEqual(isbns.cd);

    jest.setSystemTime(startPlus(expirations[2] + 60 * 1000));

    expect(fn).toHaveBeenCalledTimes(3);
    expect(cached.checkCache(isbns.a)).toHaveProperty('hit', false);
    expect(cached.checkCache(isbns.b)).toHaveProperty('hit', false);
    await expect(cached(isbns.a)).resolves.toStrictEqual(isbns.ae);

    await expect(cached(isbns.e)).resolves.toStrictEqual(isbns.ae);
    await expect(cached(isbns.c)).resolves.toStrictEqual(isbns.cd);
    await expect(cached(isbns.d)).resolves.toStrictEqual(isbns.cd);

    expect(fn).toHaveBeenCalledTimes(4);
    await expect(cached(isbns.f)).resolves.toStrictEqual(isbns.bf);

    await expect(cached(isbns.b)).resolves.toStrictEqual(isbns.bf);
    await expect(cached(isbns.a)).resolves.toStrictEqual(isbns.ae);
    await expect(cached(isbns.e)).resolves.toStrictEqual(isbns.ae);
    await expect(cached(isbns.c)).resolves.toStrictEqual(isbns.cd);
    await expect(cached(isbns.d)).resolves.toStrictEqual(isbns.cd);

    expect(fn).toHaveBeenCalledTimes(5);
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
