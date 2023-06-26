// platform independent definitions (maybe UI could be web-based inside a WebView)

export type InputParseInfo = { items: number, groupItems: Record<string, Record<string, number | undefined> | undefined> }
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

export type RequestedInput = { type: 'clipboard' } | { type: 'file' };
export type RequestedOutput = RequestedInput | { type: 'view' };

export interface UIRequestReceiver<D> {
  debugUI(info: D): Promise<void>,
  updateStatus(): 'expired' | 'pending' | 'dormant',
  requestUpdateCheck(force?: boolean): Promise<boolean>,
  requestUpdateInstall(): Promise<boolean>,
  clearPendingUpdate(): void,
  requestInput(input: RequestedInput): Promise<Input>,
  requestGroup(kind: string, name: string): Promise<Summary>,
  requestOutputMissing(kind: RequestedOutput): Promise<void>,
  requestOutputISBNs(both: boolean, kind: RequestedOutput): Promise<void>,
  requestEditionsServices(): Promise<readonly string[]>,
  requestEditions(services: string[], reporter: (report: EditionsProgress) => void): Promise<EditionsSummary>,
  requestCancelEditions(): Promise<void>,
  requestOutputEditionsISBNs(both: boolean, kind: RequestedOutput): Promise<void>,
}
