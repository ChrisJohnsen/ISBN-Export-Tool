// Common definitions for all "editions of" retrievers

import { version } from './version.js';
import { CacheControl } from './cache.js';

// types for simplified data retrieval

export type Fetcher = (url: string) => Promise<FetchResult>;

export type FetchResult = string | { status: number, statusText: string } | CacheControl<{ status: number, statusText: string }>;

export function fetcherUserAgent(platform?: string) {
  return `GoodreadsTool/${version} (${platform ? platform + '; ' : ''}+mailto:seventh_winsome.0u@icloud.com)`;
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
