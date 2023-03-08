// controller interfaces with tool-core on behalf of a non-specific UI

import production from 'consts:production';
import { assertNever, isObject } from './ts-utils.js';
import { basename, localTempfile, Log, ReadWrite, Store } from './scriptable-utils.js';
import { Command, CommandSummary, GetISBNsSummary, Input, RequestedInput, RequestedOutput, UI, UIRequestReceiver } from './ui-types.js';
import { UITableBuilder } from './uitable-builder.js';

import { type EditionsService, type Fetcher, getISBNs, missingISBNs, type Row, shelfInfo } from 'utils';
import { toCSV } from 'utils';
import { pick } from 'utils';

type CommandOutput =
  | { name: 'MissingISBNs', shelf: string, rows: Row[] }
  | { name: 'GetISBNs', shelf: string, isbns: Set<string> }
  ;

export class Controller implements UIRequestReceiver {
  constructor(private logPathnamer: (testMode: boolean) => string, private cachePathnamer: (testMode: boolean) => string) { }
  private testMode = !production;
  async debugUI() {
    const table = new UITable;
    table.showSeparators = true;
    const builder = new UITableBuilder(table, 'Debug UI');
    const build = (reload = true) => {
      reload && table.removeAllRows();

      builder.addRowWithDescribedCells([
        { type: 'text', title: 'Test Mode?', align: 'left' },
        { type: 'text', title: String(this.testMode), align: 'right' },
      ], { onSelect: () => { this.testMode = !this.testMode; build() } });
      builder.addTextRow('Test Mode makes the following changes:\n'
        + '1. The GetISBNs "Editions Of" cache is switched to a test-only location.\n'
        + '2. The GetISBNs "Editions Of" services will not make actual network requests and instead return fake data.'
        , { height: 149 });

      reload && table.reload();
    };
    build(false);
    await table.present(false);
  }
  private csv?: string;
  async requestInput(ui: UI, inputReq: RequestedInput): Promise<void> {

    const { csv, input } = await getInput();
    this.csv = csv;
    ui.input(input);

    async function getInput(): Promise<{ csv: string, input: Input }> {
      const type = inputReq.type;
      if (type == 'clipboard') {

        const clipboard = Pasteboard.pasteString();
        if (clipboard != null) // types not quite accurate, docs say can be null if no string available
          return { csv: clipboard, input: { type, info: await getInputInfo(clipboard) } };

        const a = new Alert;
        a.title = 'Clipboard Empty';
        a.message = 'No string value was available from the clipboard. Please Copy the CSV data to the clipboard before selecting this option.';
        await a.presentAlert();
        throw 'no string available from Pasteboard';

      } else if (type == 'file') {

        const pathname = await DocumentPicker.openFile();
        const csv = await new ReadWrite(pathname).readString();
        return { csv, input: { type, displayName: basename(pathname), info: await getInputInfo(csv) } };

      } else assertNever(type);

      throw `unhandled input request type: ${type}`;
    }
    async function getInputInfo(csv: string): Promise<Input['info']> {
      const { exclusive, shelfCounts } = await shelfInfo(csv).catch(e => {
        const a = new Alert;
        a.title = 'Error Parsing Input';
        a.message = 'Are you sure that was a CSV data export?';
        return a.presentAlert().then(() => Promise.reject(e), () => Promise.reject(e));
      });
      const items = Array.from(exclusive).reduce((total, shelf) => total + (shelfCounts.get(shelf) ?? 0), 0);
      const shelfItems = Object.fromEntries(Array.from(shelfCounts.entries()).sort((a, b) => {
        if (a[0] == b[0]) return 0;

        // to-read first
        if (a[0] == 'to-read') return -1;

        // exclusive before normal
        if (exclusive.has(a[0]) && !exclusive.has(b[0])) return -1;
        if (!exclusive.has(a[0]) && exclusive.has(b[0])) return 1;

        // fewer items before more items
        return a[1] - b[1];
      }));
      return { items, shelfItems };
    }
  }
  private abortingFetches = false;
  private commandPromise?: Promise<void>;
  private abortEditions?: () => void;
  async requestCommand(ui: UI, command: Command): Promise<void> {
    if (this.commandPromise) {
      console.error('requested a command while one is already running');
      return;
    }
    try {
      this.abortingFetches = false;
      this.commandPromise = this._requestCommand(ui, command);
      await this.commandPromise;
    } finally {
      this.abortEditions = void 0;
      this.commandPromise = void 0;
    }
  }
  private output?: CommandOutput;
  private async _requestCommand(ui: UI, command: Command): Promise<void> {
    if (!this.csv) throw 'requested command without first requesting input';
    let summary: CommandSummary;
    summary_ready:
    if (command.name == 'MissingISBNs') {

      const rows = await missingISBNs(this.csv, command.shelf);
      this.output = { name: 'MissingISBNs', shelf: command.shelf, rows };
      summary = { name: 'MissingISBNs', itemsMissingISBN: rows.length };

    } else if (command.name == 'GetISBNs') {

      if (command.editions.length > 0) {
        if (production && this.testMode || !production && !this.testMode) {
          const x = this.testMode
            ? {
              title: 'Warning: Test Mode Active',
              message: 'External services for Get ISBNs "Other Editions" will not be contacted, fake data will be returned instead.',
              continue: 'Continue in Test Mode',
              switch: 'Switch to Normal Mode and Continue',
            }
            : {
              title: 'Warning: Test Mode Inactive',
              message: 'Actual requests will be made to external services for Get ISBNs of "Other Editions".',
              continue: 'Continue in Normal Mode',
              switch: 'Switch to Test Mode and Continue',
            };
          const a = new Alert;
          a.title = x.title;
          a.message = x.message;
          a.addAction(x.continue);
          a.addAction(x.switch);
          a.addCancelAction('Do Not Run Get ISBNs');
          const action = await a.presentAlert();
          if (action == -1) return;
          else if (action == 1)
            this.testMode = !this.testMode;
        }
        const wv = new WebView;
        await wv.loadHTML('');
        const online = await wv.evaluateJavaScript('navigator.onLine');
        if (!online) {
          const a = new Alert;
          a.title = 'Device Offline?';
          a.message = 'This device appears to be offline.\n\nPlease make sure you have an Internet connection before doing Get ISBNs of Other Editions.';
          a.addCancelAction('Okay');
          await a.presentAlert();
          return;
        }
      }

      const fetcher: Fetcher = (fetcher => {
        return url => {
          if (this.abortingFetches) return Promise.reject(`aborting ${url}`);
          return fetcher(url);
        };
      })(this.testMode ? fakeFetcher : realFetcher);

      const log = new Log(this.logPathnamer(this.testMode));
      const store = new Store(this.cachePathnamer(this.testMode));
      await store.read();
      const cacheData = (store => {
        if (!store) return void 0;
        if (isObject(store.data))
          return store.data;
        const data = {};
        store.data = data;
        return data;
      })(store);

      const progress = { total: 0, started: 0, done: 0, fetched: 0 };
      const infos = new Map<EditionsService, { hits: number, queries: number, fetches: number[], firstBegan?: number, lastEnded?: number }>;
      const infoFor = (service: EditionsService): Parameters<typeof infos.set>[1] => {
        {
          const info = infos.get(service);
          if (info) return info;
        }
        const info = { hits: 0, queries: 0, fetches: new Array<number> };
        infos.set(service, info);
        return info;
      };

      const isbns = await getISBNs(this.csv, command.shelf, {
        otherEditions: command.editions.length != 0 && {
          services: new Set(command.editions),
          cacheData,
          fetcher,
          reporter: report => {
            if (this.abortingFetches) return;
            const ev = report.event;
            if (ev == 'abort fn') {
              this.abortEditions = report.fn;
            } else if (ev == 'rejection') {
              console.warn('GetISBNS Other Editions reported rejection');
              console.error(report.reason);
            } else if (ev == 'service cache hit') {
              infoFor(report.service).hits++;
            } else if (ev == 'query plan') {
              progress.total = Array.from(report.plan.values()).reduce((total, isbns) => total + isbns.size, 0);
            } else if (ev == 'service query started') {
              progress.started++;
              ui.commandProgress(progress);
              const info = infoFor(report.service);
              if (!info.firstBegan) info.firstBegan = Date.now();
              info.queries++;
            } else if (ev == 'fetch started') {
              console.log(`started ${report.url}`);
            } else if (ev == 'fetch finished') {
              infoFor(report.service).fetches.push(report.elapsed);
              progress.fetched++;
              ui.commandProgress(progress);
            } else if (ev == 'service query finished') {
              infoFor(report.service).lastEnded = Date.now();
              progress.done++;
              ui.commandProgress(progress);
              report.warnings.forEach(e => {
                console.warn(e.description);
                log.append(e.description);
              });
              report.faults.forEach(e => {
                console.warn(e.description);
                log.append(e.description);
              });
            }
          }
        },
        bothISBNs: command.both,
      });

      this.output = { name: 'GetISBNs', shelf: command.shelf, isbns: isbns };

      await store.write();
      await log.flush();

      if (command.editions.length == 0) {
        summary = { name: 'GetISBNs', totalISBNs: isbns.size };
        break summary_ready;
      }

      const stats = (arr: number[]) => {
        arr.sort((a, b) => a - b);
        const median = arr.length % 2 == 1 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2;
        return { min: arr[0], max: arr[arr.length - 1], median };
      };
      const editionsInfo = Object.fromEntries(Array.from(infos.entries()).map(([service, info]) => {
        const fetchRate = info.fetches.length / (((info.lastEnded ?? 0) - (info.firstBegan ?? 0)) / 1000);
        return [service, { cacheHits: info.hits, queries: info.queries, fetches: info.fetches.length, fetchRate, fetchStats: stats(info.fetches) }];
      })) as GetISBNsSummary['editionsInfo'];
      summary = { name: 'GetISBNs', totalISBNs: isbns.size, editionsInfo };

    }
    else summary = assertNever(command);

    ui.commandSummary(summary);
  }
  async requestCancelCommand(ui: UI): Promise<void> {
    await this.abortIfRunning();
    ui.commandCanceled();
  }
  async requestOutput(ui: UI, output: RequestedOutput): Promise<void> {
    if (!this.output) {
      console.error('requestOutput called before any output available');
      return;
    }
    const type = output.type;
    const { filename, output: out } = getOutput(this.output);
    if (type == 'view') {

      const file = localTempfile(filename, out);
      await QuickLook.present(file.pathname, true);
      await file.remove();

    } else if (type == 'clipboard') {

      Pasteboard.copyString(out);
      infoAlert('Copied!', 'The output has been copied to the clipboard.');

    } else if (type == 'file') {

      const pickedPaths = await DocumentPicker.exportString(out, filename); // cancel rejects
      if (pickedPaths.length == 1)
        infoAlert('Saved to File', 'The output has been saved to the file:\n\n' + basename(pickedPaths[0]));
      else if (pickedPaths.length > 1)
        infoAlert('Saved to Multiple Files?', 'The output has been saved to the files?:\n\n' + pickedPaths.map(basename).join('\n'));

    } else assertNever(type);

    function infoAlert(title: string, message: string) {
      const a = new Alert;
      a.title = title;
      a.message = message;
      a.addCancelAction('Okay');
      a.presentAlert();
    }
    function getOutput(output: CommandOutput): { filename: string, output: string } {
      if (output.name == 'MissingISBNs') {
        const pickedColumns = output.rows.map(pick(['Book Id', 'Title', 'Author', 'Bookshelves']));
        return { filename: `ISBNS missing on ${output.shelf}.csv`, output: toCSV(pickedColumns) };
      } else if (output.name == 'GetISBNs') {
        return { filename: `ISBNs on ${output.shelf}.txt`, output: Array.from(output.isbns).join('\n') };
      } else assertNever(output);
    }
  }
  async abortIfRunning() {
    this.abortingFetches = true;
    this.abortEditions?.();
    await this.commandPromise;
  }
}

import { fetcherUserAgent, serverThrottledFetcher } from 'utils';

const realFetcher = serverThrottledFetcher(async url => {
  const req = new Request(url);
  req.headers = { 'User-Agent': fetcherUserAgent('Scriptable') };
  const body = await req.loadString();

  const status = (s => typeof s == 'number' ? s : parseInt(s, 10))(req.response.statusCode);
  if (200 <= status && status < 300) return body;

  const statusText = '';
  const headers = new Map(Object.entries(req.response.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const retryAfter = headers.get('retry-after');
  if (typeof retryAfter == 'string')
    return { status, statusText, retryAfter };
  else
    return { status, statusText };
});

import { equivalentISBNs } from 'utils';
import { type FetchResult } from 'utils';

// generate fake data for the "editions of" parsers to consume so we do not make real requests while testing
async function fakeFetcher(url: string): Promise<FetchResult> {
  const makeReplacementRequests = false;
  if (makeReplacementRequests) {
    const s = Date.now();
    const furl = /openlibrary/.test(url) ? 'https://httpbin.org/delay/0' : 'https://httpbun.com/delay/0';
    await new Request(furl).loadString();
    console.log(Date.now() - s);
  } else {
    const randomInt = (n: number) => Math.trunc(Math.random() * n);
    await new Promise<void>(res => Timer.schedule(randomInt(200) * 1 + 200, false, res));
  }
  const isbnSearchMatch = url.match(/[?&]q=([ -\dxX]*)/);
  if (isbnSearchMatch) {
    const isbns = equivalentISBNs(isbnSearchMatch[1]);
    return JSON.stringify({ docs: [{ isbn: [`${isbns[0]}-1234`, ...(isbns.length > 1 ? [`${isbns[1]}-5678`] : [])] }] });
  }

  const isbnMatch = url.match(/\/isbn\/(.*)\.json$/);
  if (isbnMatch) return JSON.stringify({ works: [{ key: `/works/OL${equivalentISBNs(isbnMatch[1])[0]}W` }] });

  const workMatch = url.match(/\/works\/OL(.*)W\/editions\.json$/);
  if (workMatch) {
    const isbns = equivalentISBNs(workMatch[1]);
    return JSON.stringify({ entries: [{ isbn_13: [`${isbns[0]}-1234`], ...(isbns.length > 1 ? { isbn_10: [`${isbns[1]}-5678`] } : {}) }] });
  }

  const thingMatch = url.match(/thingISBN\/(.*)$/);
  if (thingMatch) {
    const isbns = equivalentISBNs(thingMatch[1]);
    return `<idlist>${[`${isbns[0]}-1234`, ...(isbns.length > 1 ? [`${isbns[1]}-5678`] : [])].map(i => `<isbn>${i}</isbn>`).join('')}</idlist>`;
  }

  throw `nope: ${url}`;
}

