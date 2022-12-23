import { describe, test, expect, jest } from '@jest/globals';
import { cachePromisor } from 'utils';
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

    const reCached = cachePromisor(fn, {
      isArgument: t.isString(),
      isResolvesTo: t.isNumber(),
      cache: cached.saveCache(),
    });

    await expect(cached('sixteen')).resolves.toBe(16);
    await expect(reCached('sixteen')).resolves.toBe(16);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
