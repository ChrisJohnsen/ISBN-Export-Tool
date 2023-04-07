// controller interfaces with tool-core on behalf of a non-specific UI

import production from 'consts:production';
import git from 'consts:git';
import { version } from 'utils';

import { isObject } from './ts-utils.js';
import { basename, localTempfile, Log, ReadWrite, Store } from './scriptable-utils.js';
import { type EditionsProgress, type EditionsSummary, type Input, type InputParseInfo, type RequestedInput, type RequestedOutput, type UIRequestReceiver } from './ui-types.js';
import { UITableBuilder } from './uitable-builder.js';

import { assertNever } from 'utils';
import { type EditionsService, type Fetcher, type Row, AllEditionsServices, parseCSVRows, type ProgressReport, bothISBNsOf, getEditionsOf, guessFormat, type ExportFormat } from 'utils';
import { type CheckStorage, isCheckStorage, webcheck, webcheckExpired } from 'utils';
import { toCSV } from 'utils';
import { pick } from 'utils';

export class Controller implements UIRequestReceiver {
  private disabledEditionsServices: Set<EditionsService>;
  constructor(private logPathnamer: (testMode: boolean) => string, private cachePathnamer: (testMode: boolean) => string, private webcheckData: Record<string, unknown>, private saveData: () => Promise<void>) {
    this.disabledEditionsServices = new Set(['Open Library WorkEditions']);
  }
  private enableEditionsService(service: EditionsService, enable = true) {
    if (enable)
      this.disabledEditionsServices.delete(service);
    else
      this.disabledEditionsServices.add(service);
  }
  private testMode = !production;
  async debugUI() {
    const table = new UITable;
    table.showSeparators = true;
    const builder = new UITableBuilder(table, 'Debug UI');
    const build = (reload = true) => {
      reload && table.removeAllRows();

      builder.addTextRow(`Version: ${version}`);
      builder.addTextRow(`Git: ${git.description}`);
      builder.addTextRow(production ? 'Production Mode' : 'Development Mode');
      builder.addEmptyRow();
      builder.addRowWithDescribedCells([
        { type: 'text', title: 'Test Mode?', align: 'left' },
        { type: 'text', title: String(this.testMode), align: 'right' },
      ], { onSelect: () => { this.testMode = !this.testMode; build() } });
      builder.addIndentRow('Test Mode makes the following changes:\n'
        + '1. The GetISBNs "Editions Of" cache is switched to a test-only location.\n'
        + '2. The GetISBNs "Editions Of" services will not make actual network requests and instead return fake data.'
        , { height: 149 });
      const olweStatus = this.disabledEditionsServices.has('Open Library WorkEditions') ? 'disabled' : 'enabled';
      const olweToggle = () => this.enableEditionsService('Open Library WorkEditions', !this.disabledEditionsServices.has('Open Library WorkEditions'));
      builder.addRowWithDescribedCells([
        { type: 'text', title: 'OL:WE status', align: 'left' },
        { type: 'text', title: olweStatus, align: 'right' },
      ], { onSelect: () => { olweToggle(); build() } });
      builder.addIndentRow('OL:WE requires 1+N fetches/ISBN (throttled to 1 fetch/second) '
        + 'and probably gives the same results as OL:S (which needs only 1 fetch/ISBN).', { height: 132 });

      reload && table.reload();
    };
    build(false);
    await table.present(false);
  }
  private get pendingUpdate(): string | undefined {
    const content = this.webcheckData.updateContent;
    if (typeof content == 'string') return content;
    this.webcheckData.updateContent = void 0;
    return void 0;
  }
  private set pendingUpdate(content: string | undefined) {
    this.webcheckData.updateContent = content;
  }
  private get updatesData(): CheckStorage {
    const d = this.webcheckData.updatesData;
    if (isCheckStorage(d)) return d;
    this.webcheckData.updatesData = void 0;
    return void 0;
  }
  private set updatesData(data: CheckStorage) {
    this.webcheckData.updatesData = data;
  }
  updateStatus() {
    if (webcheckExpired(this.updatesData))
      return 'expired';
    if (this.pendingUpdate)
      return 'pending';
    return 'dormant';
  }
  async requestUpdateCheck(force = false) {
    const data = this.updatesData;
    if (force && data) data.expires = Date.now() - 1000;

    this.updatesData = await webcheck(checkableFetcher,
      // https://github.com/ChrisJohnsen/ISBN-Export-Tool/raw/released/Scriptable/ISBN%20Tool.js
      'https://raw.githubusercontent.com/ChrisJohnsen/ISBN-Export-Tool/released/Scriptable/ISBN%20Tool.js',
      1000 * 60 * 60 * 24 * 30,
      data,
      s => {
        const gitMatch = s.match(/\bgit: (\S+)/);
        const description = gitMatch?.[1] ?? '<no description found>';
        this.pendingUpdate = s && description != git.description
          ? s : void 0;
        return description;
      });
    return !!this.pendingUpdate;
  }
  async requestUpdateInstall() {
    if (this.pendingUpdate) {
      FileManager.local().writeString(module.filename, this.pendingUpdate);
      this.pendingUpdate = void 0;
      await this.saveData();
      Timer.schedule(5 * 1000, false, () => Safari.open(URLScheme.forRunningScript()));
      return true;
    }
    return false;
  }
  clearPendingUpdate() {
    this.pendingUpdate = void 0;
  }
  private allRows: Row[] = [];
  private format?: ExportFormat;
  async requestInput(inputReq: RequestedInput) {

    const { rows, format, input } = await getInput();
    this.allRows = rows;
    this.format = format;
    return input;

    async function getInput(): Promise<{ rows: Row[], format: ExportFormat, input: Input }> {
      const type = inputReq.type;
      if (type == 'clipboard') {

        const clipboard = Pasteboard.pasteString();
        if (clipboard != null) { // types not quite accurate, docs say can be null if no string available
          const { rows, format } = await parseRows(clipboard);
          return { rows, format, input: { type, ...await getInputInfo(format, rows) } };
        }

        const a = new Alert;
        a.title = 'Clipboard Empty';
        a.message = 'No string value was available from the clipboard. Please Copy the CSV data to the clipboard before selecting this option.';
        await a.presentAlert();
        throw 'no string available from Pasteboard';

      } else if (type == 'file') {

        const pathname = await DocumentPicker.openFile();
        const csv = await new ReadWrite(pathname).readString();
        const { rows, format } = await parseRows(csv);
        return { rows, format, input: { type, displayName: basename(pathname), ...await getInputInfo(format, rows) } };

      } else assertNever(type);

      throw `unhandled input request type: ${type}`;
    }
    async function parseRows(csv: string): Promise<{ format: ExportFormat, rows: Row[] }> {
      try {
        const rows = await parseCSVRows(csv);
        const format = guessFormat(rows);
        return { rows, format };
      } catch (e) {
        console.error(e);
        const a = new Alert;
        a.title = 'Error Parsing Input';
        a.message = 'Are you sure that was a CSV data export?';
        await a.presentAlert();
        throw e;
      }
    }
    async function getInputInfo(format: ExportFormat, rows: Row[]): Promise<InputParseInfo> {
      const groupInfo = format.groupInfo(rows);
      const groupItems = Object.fromEntries(Array.from(groupInfo.entries()).map(([groupKind, kindInfo]) => {
        return [groupKind, Object.fromEntries(Array.from(kindInfo.entries()).sort((a, b) => {
          if (a[0] < b[0]) return -1;
          if (a[0] > b[0]) return 1;
          return a[1] - b[1];
        }))];
      }).sort((a, b) => {
        if (a[0] < b[0]) return -1;
        if (a[0] > b[0]) return 1;
        return 0;
      }));
      return { items: rows.length, groupItems };
    }
  }
  private selected?: { group: { kind: string, name: string }, missingRows: Row[], isbns: Set<string> };
  async requestGroup(kind: string, name: string) {
    if (!this.format) throw 'requested group before format established';

    const { missingISBN: missingRows, isbns } = this.format.missingAndISBNs(this.format.rowsInGroup(this.allRows, kind, name));
    this.selected = { group: { kind, name }, missingRows, isbns };
    return { missingISBNCount: missingRows.length, isbnCount: isbns.size };
  }
  async requestOutputMissing(kind: RequestedOutput) {
    if (!this.format) throw 'requested output before format established';
    if (!this.selected) throw 'requested output before anything selected';

    const filename = `ISBNS missing in ${this.selected.group.kind} ${this.selected.group.name}.csv`;
    const output = toCSV(this.selected.missingRows.map(pick(Array.from(this.format.mainColumns))));
    return this.output(kind, filename, output);
  }
  async requestOutputISBNs(both: boolean, kind: RequestedOutput) {
    if (!this.selected) throw 'requested output before anything selected';

    const filename = `ISBNs on ${this.selected.group.kind} ${this.selected.group.name}.txt`;
    const isbns = both ? bothISBNsOf(this.selected.isbns) : this.selected.isbns;
    const output = Array.from(isbns).join('\n');
    return this.output(kind, filename, output);
  }
  private async output(output: RequestedOutput, filename: string, out: string) {
    const type = output.type;

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
  }
  private async refreshDisabledEditionsServices() {
    const data = (d => {
      if (isCheckStorage(d)) return d;
      this.webcheckData.disabledEditionsData = void 0;
      return void 0;
    })(this.webcheckData.disabledEditionsData);

    const newData = await webcheck(checkableFetcher,
      // https://github.com/ChrisJohnsen/ISBN-Export-Tool/raw/released/disabled-services
      'https://raw.githubusercontent.com/ChrisJohnsen/ISBN-Export-Tool/released/disabled-services',
      1000 * 60 * 60 * 24 * 7,
      data);
    this.webcheckData.disabledEditionsData = newData;

    const content = newData?.content;
    if (!content) return new Set<EditionsService>;
    else return new Set(content
      .split('\n')
      .map(s => s.trim())
      .filter((s): s is EditionsService => (AllEditionsServices as Set<string>).has(s)));
  }
  private activeServices?: Set<EditionsService>;
  async requestEditionsServices() {
    const enabled = new Set(AllEditionsServices);
    const disabled = await this.refreshDisabledEditionsServices();
    disabled.forEach(s => enabled.delete(s));
    this.disabledEditionsServices.forEach(s => enabled.delete(s));

    this.activeServices = enabled;
    return Array.from(enabled);
  }
  private abortingFetches = false;
  private editionsPromise?: Promise<EditionsSummary>;
  private abortEditions?: () => void;
  private edtionsISBNs: Set<string> = new Set;
  async requestEditions(services: string[], editionsReporter: (report: EditionsProgress) => void) {
    if (!this.selected) throw 'requested editions before anything selected';
    if (!this.activeServices) throw 'requested editions before services requested';

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
      if (action == -1) throw 'Aborted Get ISBNs after checking test mode';
      else if (action == 1)
        this.testMode = !this.testMode;
    }

    if (this.editionsPromise) {
      console.error('requested a editions while it is already running');
      throw 'editions already running';
    }

    const isbns = this.selected.isbns;

    this.abortingFetches = false;
    this.editionsPromise = (async () => {
      const fetcher: Fetcher = (fetcher => {
        return url => {
          if (this.abortingFetches) return Promise.reject(`aborting ${url}`);
          return fetcher(url);
        };
      })(this.testMode ? fakeFetcher : realFetcher);

      const log = new Log(this.logPathnamer(this.testMode));
      const store = new Store(this.cachePathnamer(this.testMode));

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
      const reporter = (report: ProgressReport) => {
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
          editionsReporter(progress);
          const info = infoFor(report.service);
          if (!info.firstBegan) info.firstBegan = Date.now();
          info.queries++;
        } else if (ev == 'fetch started') {
          console.log(`started ${report.url}`);
        } else if (ev == 'fetch finished') {
          infoFor(report.service).fetches.push(report.elapsed);
          progress.fetched++;
          editionsReporter(progress);
        } else if (ev == 'service query finished') {
          infoFor(report.service).lastEnded = Date.now();
          progress.done++;
          editionsReporter(progress);
          report.warnings.forEach(e => {
            console.warn(e.description);
            log.append(e.description);
          });
          report.faults.forEach(e => {
            console.warn(e.description);
            log.append(e.description);
          });
        }
      };

      await store.read();
      const cacheData = (store => {
        if (!store) return void 0;
        if (isObject(store.data))
          return store.data;
        const data = {};
        store.data = data;
        return data;
      })(store);

      const valid = (s: string): s is EditionsService => (AllEditionsServices as Set<string>).has(s);
      const enabled = (s: EditionsService) => this.activeServices?.has(s);

      const editionsISBNs = await getEditionsOf(isbns, {
        services: new Set(services.filter(valid).filter(enabled)),
        cacheData,
        fetcher,
        reporter
      });

      await store.write();
      await log.flush();

      const stats = (arr: number[]) => {
        arr.sort((a, b) => a - b);
        const median = arr.length % 2 == 1 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2;
        return { min: arr[0], max: arr[arr.length - 1], median };
      };
      const editionsServicesSummary = Object.fromEntries(Array.from(infos.entries()).map(([service, info]) => {
        const fetchRate = info.fetches.length / (((info.lastEnded ?? 0) - (info.firstBegan ?? 0)) / 1000);
        return [service, { cacheHits: info.hits, queries: info.queries, fetches: info.fetches.length, fetchRate, fetchStats: stats(info.fetches) }];
      }));

      this.edtionsISBNs = editionsISBNs;
      return { isbns: editionsISBNs.size, editionsServicesSummary };
    })();

    try {
      return await this.editionsPromise;
    } finally {
      this.abortEditions = void 0;
      this.editionsPromise = void 0;
    }
  }
  async requestCancelEditions() {
    return this.abortIfRunning();
  }
  async requestOutputEditionsISBNs(both: boolean, kind: RequestedOutput) {
    if (!this.selected) throw 'requested output before anything selected';

    const filename = `ISBNs of editions of ISBNs on ${this.selected.group.kind} ${this.selected.group.name}.txt`;
    const isbns = both ? bothISBNsOf(this.edtionsISBNs) : this.edtionsISBNs;
    const output = Array.from(isbns).join('\n');
    return this.output(kind, filename, output);
  }
  async abortIfRunning() {
    this.abortingFetches = true;
    this.abortEditions?.();
    await this.editionsPromise;
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
import type { FetchResult } from 'utils';

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


import { type CheckHeaders } from 'utils';

async function checkableFetcher(url: string, previousCheckHeaders?: CheckHeaders) {
  const req = new Request(url);

  const headers: Record<string, string> = {};
  headers['User-Agent'] = fetcherUserAgent('Scriptable');
  if (previousCheckHeaders)
    if (previousCheckHeaders.ETag)
      headers['If-None-Match'] = previousCheckHeaders.ETag;
    else if (previousCheckHeaders['Last-Modified'])
      headers['If-Modified-Since'] = previousCheckHeaders['Last-Modified'];
  req.headers = headers;

  const content = await req.loadString();

  const status = (s => typeof s == 'number' ? s : parseInt(s))(req.response.statusCode);
  const checkHeaders: CheckHeaders = (h => {
    const map = new Map(Object.entries(h)
      .filter((hv: [string, unknown]): hv is [string, string] => typeof hv[1] == 'string')
      .map(([h, v]) => [h.toLowerCase(), v]));
    return { ETag: map.get('ETag'.toLowerCase()), 'Last-Modified': map.get('Last-Modified'.toLowerCase()) };
  })(req.response.headers);

  return { status, content, checkHeaders };
}
