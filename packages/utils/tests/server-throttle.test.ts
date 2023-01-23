import { describe, test, expect, jest, afterEach, beforeEach } from '@jest/globals';
import { ServerThrottle } from 'utils';

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
