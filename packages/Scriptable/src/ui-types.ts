// platform independent definitions (maybe UI could be web-based inside a WebView)

// UI interface

export type InputParseInfo = { items: number, shelfItems: Record<string, number | undefined> }
export type Input = (
  | { type: 'clipboard' }
  | { type: 'file', displayName: string }
) & InputParseInfo;
export type Summary = {
  missingISBNCount: number,
  isbnCount: number,
};
export type EditionsSummary = {
  isbns: number,
  editionsServicesSummary: {
    [editionService: string]: undefined | {
      cacheHits: number,
      queries: number,
      fetches: number,
      fetchRate: number,
      fetchStats: { min: number, median: number, max: number }
    }
  },
};
export type EditionsProgress = { total: number, started: number, done: number, fetched: number };

export interface UI {
  editionsServices(enabledServices: readonly string[]): void,
  input(input: Input): void,
  summary(summary: Summary): void,
  outputDone(): void,
  editionsProgress(progress: EditionsProgress): void,
  editionsCanceled(): void,
  editionsSummary(summary: EditionsSummary): void,
}

// controller interface

export type RequestedInput = { type: 'clipboard' } | { type: 'file' };
export type RequestedOutput = RequestedInput | { type: 'view' };

export interface UIRequestReceiver {
  debugUI(ui: UI): void,
  requestEditionsServices(ui: UI): void,
  requestInput(ui: UI, input: RequestedInput): void,
  requestShelf(ui: UI, shelf: string): void,
  requestOutputMissing(ui: UI, kind: RequestedOutput): void,
  requestOutputISBNs(ui: UI, both: boolean, kind: RequestedOutput): void,
  requestEditions(ui: UI, services: string[]): void,
  requestCancelEditions(ui: UI): void,
  requestOutputEditionsISBNs(ui: UI, both: boolean, kind: RequestedOutput): void,
}
