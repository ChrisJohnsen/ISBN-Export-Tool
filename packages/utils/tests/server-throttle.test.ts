import { describe, test, expect, jest, afterEach, beforeEach } from '@jest/globals';
import { CacheControl, ServerThrottle, ThrottleableFetcher } from 'utils';

describe('ServerThrottle', () => {
  describe('URL variations', () => {
    const url = 'https://SomeServer.NET/path';
    let t: ServerThrottle;

    beforeEach(() => {
      t = new ServerThrottle;
      t.set(url, '60');
    });

    test('unmodified', () => {
      expect(t.shouldThrottle(url)).toBeTruthy();
    });

    test('scheme', () => {
      expect(t.shouldThrottle(url.replace(/^https/, 'http'))).toBeTruthy();
    });

    test('server case', () => {
      expect(t.shouldThrottle(url.toLowerCase())).toBeTruthy();
    });

    test('path', () => {
      expect(t.shouldThrottle(url.replace(/\/path$/, ''))).toBeTruthy();
      expect(t.shouldThrottle(url.replace(/path$/, 'other/location'))).toBeTruthy();
    });

    test('query', () => {
      expect(t.shouldThrottle(url + '?t=1')).toBeTruthy();
    });
  });

  describe('Retry-After variations', () => {
    afterEach(() => void jest.useRealTimers());

    test('integer seconds', () => {
      jest.useFakeTimers();
      const url = 'https://SomeServer.NET/path';
      const t = new ServerThrottle;

      expect(t.shouldThrottle(url)).toBeFalsy();

      t.set(url, '60');

      expect(t.shouldThrottle(url)).toBeTruthy();

      jest.setSystemTime(Date.now() + 60 * 1000 - 500);

      expect(t.shouldThrottle(url)).toBeTruthy();

      jest.setSystemTime(Date.now() + 60 * 1000 + 500);

      expect(t.shouldThrottle(url)).toBeFalsy();
    });

    test('HTTP Date', () => {
      jest.useFakeTimers();
      const url = 'https://SomeServer.NET/path';
      const t = new ServerThrottle;

      expect(t.shouldThrottle(url)).toBeFalsy();

      const date = new Date(Date.now() + 300 * 1000);
      date.setUTCMilliseconds(0);
      const dateStr = date.toUTCString();
      t.set(url, dateStr);

      expect(t.shouldThrottle(url)).toBeTruthy();

      jest.setSystemTime(date.valueOf() - 500);

      expect(t.shouldThrottle(url)).toBeTruthy();

      jest.setSystemTime(date.valueOf() + 500);

      expect(t.shouldThrottle(url)).toBeFalsy();
    });
  });
});

import { serverThrottledFetcher } from 'utils';

describe('serverThrottledFetcher', () => {
  afterEach(() => void jest.useRealTimers());

  test('prior 429 and 503 cause throttling until Retry-After', async () => {
    jest.useFakeTimers();
    const mockedThrottleableFetcher = jest.fn<ThrottleableFetcher>()
      .mockResolvedValueOnce('body')
      .mockResolvedValueOnce({ status: 429, statusText: 'Try again later', retryAfter: '300' })
      .mockResolvedValueOnce('body')
      .mockResolvedValueOnce({ status: 503, statusText: 'Not ready', retryAfter: '600' })
      .mockResolvedValueOnce('body');
    const tf = serverThrottledFetcher(mockedThrottleableFetcher);

    await expect(tf('some URL')).resolves.toBe('body');
    expect(mockedThrottleableFetcher).toHaveBeenCalledTimes(1);

    const first = Date.now();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function ecc(r: any, exp: number, value: any) {
      expect(r).toBeInstanceOf(CacheControl);

      if (!(r instanceof CacheControl)) return;

      expect(r.expiration).toBeCloseTo(exp, -4);
      expect(r.value).toStrictEqual(value);
    }

    ecc(await tf('some URL'), first + 300_000, { status: 429, statusText: 'Try again later' });
    ecc(await tf('some URL'), first + 300_000, { status: 429, statusText: expect.stringMatching(/^server requested throttling until /) });

    jest.setSystemTime(first + 100_000);

    ecc(await tf('some URL'), first + 300_000, { status: 429, statusText: expect.stringMatching(/^server requested throttling until /) });

    expect(mockedThrottleableFetcher).toHaveBeenCalledTimes(2);

    jest.setSystemTime(first + 301_000); // server-requested throttle expires

    await expect(tf('some URL')).resolves.toStrictEqual('body');
    expect(mockedThrottleableFetcher).toHaveBeenCalledTimes(3);

    const second = Date.now();

    ecc(await tf('some URL'), second + 600_000, { status: 503, statusText: 'Not ready' });
    ecc(await tf('some URL'), second + 600_000, { status: 429, statusText: expect.stringMatching(/^server requested throttling until /) });

    jest.setSystemTime(second + 301_000);

    ecc(await tf('some URL'), second + 600_000, { status: 429, statusText: expect.stringMatching(/^server requested throttling until /) });

    expect(mockedThrottleableFetcher).toHaveBeenCalledTimes(4);

    jest.setSystemTime(second + 601_000); // server-requested throttle expires

    await expect(tf('some URL')).resolves.toStrictEqual('body');
    expect(mockedThrottleableFetcher).toHaveBeenCalledTimes(5);
  });
});
