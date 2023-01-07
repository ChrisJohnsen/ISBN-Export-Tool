// Common definitions for all "editions of" retrievers

// types for simplified data retrieval

export type Fetcher = (url: string) => Promise<FetchResult>;

export type FetchResult = string | { status: number; statusText: string; };

// result types for "editions of" functions

export interface EditionsISBNResults {
  isbns: Set<string>;
  warnings: ContentError[];
  temporaryFaults: ContentError[];
}

export class ContentError {
  constructor(public description: string) { }
}
