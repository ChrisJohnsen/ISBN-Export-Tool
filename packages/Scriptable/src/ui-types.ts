// platform independent definitions (maybe UI could be web-based inside a WebView)

// UI interface

export type IO = { type: 'clipboard' } | { type: 'file', displayName: string };
export type Input = IO & { info: { items: number, shelfItems: Record<string, number> } };
export type MissingISBNsSummary = { name: 'MissingISBNs', itemsMissingISBN: number };
export type GetISBNsSummary = {
  name: 'GetISBNs', editionsInfo?: {
    string?: {
    cacheHits: number,
    queries: number,
    fetches: number,
    fetchRate: number,
    fetchStats: { min: number, median: number, max: number }
  } }, totalISBNs: number
};
export type CommandSummary = MissingISBNsSummary | GetISBNsSummary;

export interface UI {
  editionsServices(enabledServices: readonly string[]): void,
  input(input: Input): void,
  commandProgress(progress: { total: number, started: number, done: number, fetched: number }): void,
  commandCanceled(): void;
  commandSummary(summary: CommandSummary): void,

  getSavableData?(): unknown,
}

// controller interface

export type RequestedInput = { type: 'clipboard' } | { type: 'file' };
export type RequestedOutput = RequestedInput | { type: 'view' };
export type MissingISBNs = { name: 'MissingISBNs', shelf: string };
export type GetISBNs = { name: 'GetISBNs', shelf: string, both: boolean, editions: readonly string[] };
export type Command = MissingISBNs | GetISBNs;

export interface UIRequestReceiver {
  debugUI(ui: UI): void,
  requestEditionsServices(ui: UI): void,
  requestInput(ui: UI, input: RequestedInput): void,
  requestCommand(ui: UI, command: Command): void,
  requestCancelCommand(ui: UI): void,
  requestOutput(ui: UI, output: RequestedOutput): void,
}
