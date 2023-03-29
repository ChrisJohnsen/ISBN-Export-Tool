import { describe, test, expect, jest, afterEach } from '@jest/globals';
import { type CheckableFetcher, type CheckHeaders, type CheckStorage, webcheck } from 'utils';

describe('webcheck', () => {
  afterEach(() => void jest.useRealTimers());

  test('rejecting fetcher', async () => {
    await expect(webcheck(() => Promise.reject('rejected!'), 'some URL', 1000, void 0)).rejects.toBeDefined();
  });

  test('no check headers from fetcher', async () => {
    jest.useFakeTimers();

    const fetcher = jest.fn<CheckableFetcher>()
      .mockResolvedValueOnce({ status: 200, content: 'A', checkHeaders: {} })
      .mockResolvedValueOnce({ status: 200, content: 'B', checkHeaders: {} });

    // fresh

    const start = Date.now();
    let c: CheckStorage = await webcheck(fetcher, 'some URL', 1000, void 0);

    expect(c).toStrictEqual({ content: 'A', expires: start + 1000 });

    // reused A

    if (c) c.content = 'A2';
    jest.setSystemTime(start + 500);
    c = await webcheck(fetcher, 'some URL', 1000, c);

    expect(c).toStrictEqual({ content: 'A2', expires: start + 1000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenLastCalledWith('some URL', void 0);

    // expired

    if (c) c.content = 'A3';
    jest.setSystemTime(start + 1001);
    c = await webcheck(fetcher, 'some URL', 1000, c);

    expect(c).toStrictEqual({ content: 'B', expires: start + 2001 });

    // reused B

    if (c) c.content = 'B2';
    jest.setSystemTime(start + 1501);
    c = await webcheck(fetcher, 'some URL', 1000, c);

    expect(c).toStrictEqual({ content: 'B2', expires: start + 2001 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith('some URL', expect.objectContaining({}));
  });

  test.each(['ETag', 'Last-Modified', 'both'] as const)('%s from fetcher', async p => {
    jest.useFakeTimers();

    function headers(p: 'ETag' | 'Last-Modified' | 'both', x: string): CheckHeaders {
      if (p == 'both') return {
        ETag: x + ' ETag',
        'Last-Modified': x + ' Last-Modified'
      };
      return { [p]: x + ' ' + p };
    }

    const fetcher = jest.fn<CheckableFetcher>()
      .mockResolvedValueOnce({ status: 200, content: 'A', checkHeaders: headers(p, 'A') })
      .mockResolvedValueOnce({ status: 304, content: '', checkHeaders: headers(p, 'A') })
      .mockResolvedValueOnce({ status: 304, content: '', checkHeaders: headers(p, 'A') })
      .mockResolvedValueOnce({ status: 200, content: 'B', checkHeaders: headers(p, 'B') })
      .mockResolvedValueOnce({ status: 304, content: '', checkHeaders: headers(p, 'B') });

    // A

    const start = Date.now();
    let c: CheckStorage = await webcheck(fetcher, 'some URL', 1000, void 0);

    expect(c).toStrictEqual({ content: 'A', expires: start + 1000, ...headers(p, 'A') });

    if (c) c.content = 'A2';
    jest.setSystemTime(start + 500);
    c = await webcheck(fetcher, 'some URL', 1000, c);

    expect(c).toStrictEqual({ content: 'A2', expires: start + 1000, ...headers(p, 'A') });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenLastCalledWith('some URL', void 0);

    // expires, but 304 for A header

    if (c) c.content = 'A3';
    jest.setSystemTime(start + 1001);
    c = await webcheck(fetcher, 'some URL', 1000, c);

    expect(c).toStrictEqual({ content: 'A3', expires: start + 2001, ...headers(p, 'A') });

    if (c) c.content = 'A4';
    jest.setSystemTime(start + 1501);
    c = await webcheck(fetcher, 'some URL', 1000, c);

    expect(c).toStrictEqual({ content: 'A4', expires: start + 2001, ...headers(p, 'A') });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith('some URL', expect.objectContaining(headers(p, 'A')));

    // expires again, but 304 for A header

    if (c) c.content = 'A5';
    jest.setSystemTime(start + 2002);
    c = await webcheck(fetcher, 'some URL', 1000, c);

    expect(c).toStrictEqual({ content: 'A5', expires: start + 3002, ...headers(p, 'A') });

    if (c) c.content = 'A6';
    jest.setSystemTime(start + 2502);
    c = await webcheck(fetcher, 'some URL', 1000, c);

    expect(c).toStrictEqual({ content: 'A6', expires: start + 3002, ...headers(p, 'A') });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenLastCalledWith('some URL', expect.objectContaining(headers(p, 'A')));

    // B

    if (c) c.content = 'A7';
    jest.setSystemTime(start + 3003);
    c = await webcheck(fetcher, 'some URL', 1000, c);

    expect(c).toStrictEqual({ content: 'B', expires: start + 4003, ...headers(p, 'B') });

    if (c) c.content = 'B2';
    jest.setSystemTime(start + 3503);
    c = await webcheck(fetcher, 'some URL', 1000, c);

    expect(c).toStrictEqual({ content: 'B2', expires: start + 4003, ...headers(p, 'B') });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher).toHaveBeenLastCalledWith('some URL', expect.objectContaining(headers(p, 'A')));

    // expires, but 304 for B header

    if (c) c.content = 'B3';
    jest.setSystemTime(start + 4004);
    c = await webcheck(fetcher, 'some URL', 1000, c);

    expect(c).toStrictEqual({ content: 'B3', expires: start + 5004, ...headers(p, 'B') });

    if (c) c.content = 'B4';
    jest.setSystemTime(start + 4504);
    c = await webcheck(fetcher, 'some URL', 1000, c);

    expect(c).toStrictEqual({ content: 'B4', expires: start + 5004, ...headers(p, 'B') });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher).toHaveBeenLastCalledWith('some URL', expect.objectContaining(headers(p, 'B')));
  });
});
