// Common definitions for all "editions of" retrievers

import { version } from './version.js';
import { CacheControl, type MaybeCacheControl } from './cache.js';

// types for simplified data retrieval

export type Fetcher = (url: string) => Promise<FetchResult>;

export type BareFetchResult = string | { status: number, statusText: string };
export type FetchResult = MaybeCacheControl<BareFetchResult>;

export function fetcherUserAgent(platform?: string) {
  return `ISBNExportTool/${version} (${platform ? platform + '; ' : ''}+mailto:seventh_winsome.0u@icloud.com)`;
}

export class ServerThrottle {
  private throttles = new Map<string, number>;
  set(url: string, retryAfter: string): Date {
    const server = serverOf(url);
    const match = retryAfter.match(/^\s*(\d+)\s*$/);
    const date = match ? new Date(Date.now() + parseInt(match[1]) * 1000) : new Date(retryAfter);
    this.throttles.set(server, date.valueOf());
    return date;
  }
  shouldThrottle(url: string): false | Date {
    const date = this.throttles.get(serverOf(url));
    if (typeof date != 'undefined' && Date.now() < date)
      return new Date(date);
    return false;
  }
}

function serverOf(url: string) {
  const match = url.match(new RegExp('^https?://([^/]+)'));
  if (match) return match[1].toLowerCase();
  else return url;
}

export type ThrottleableFetcher = (url: string) => Promise<ThrottleableFetchResult>;
export type ThrottleableFetchResult = { status: number, statusText: string, retryAfter?: string | null } | string;
export function serverThrottledFetcher(throttleableFetcher: ThrottleableFetcher): Fetcher {
  const serverThrottle = new ServerThrottle;

  return async url => {
    const waitUntil = serverThrottle.shouldThrottle(url);
    if (waitUntil != false)
      return new CacheControl({ status: 429, statusText: 'server requested throttling until ' + waitUntil.toUTCString() }, { until: waitUntil });

    const fetchResult = await throttleableFetcher(url);
    if (typeof fetchResult == 'string') return fetchResult;

    const { status, statusText, retryAfter } = fetchResult;
    if (status == 429 || status == 503) {
      const date =
        retryAfter
          ? serverThrottle.set(url, retryAfter)
          : serverThrottle.set(url, '600');
      return new CacheControl({ status, statusText }, { until: date });
    }
    return { status, statusText };
  };
}

// result types for "editions of" functions

export interface EditionsISBNResults {
  isbns: Set<string>,
  warnings: ContentError[],
  temporaryFaults: ContentError[],
  cacheUntil?: number,
}

export class ContentError {
  constructor(public description: string) { }
}
