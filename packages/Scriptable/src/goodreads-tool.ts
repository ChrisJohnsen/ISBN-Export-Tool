// Scriptable front end for tool-core

// TypeScript generic stuff

function assertNever(value: never) { void value; throw 'assertNever called' }

// Scriptable generic stuff

function dirname(path: string) {
  const lfm = FileManager.local();
  const filename = lfm.fileName(path, true);
  if (!path.endsWith(filename)) throw 'path does not end with extracted filename!?';
  const dirSlash = path.slice(0, path.length - filename.length);
  return dirSlash.replace(/[/]*$/, '');
}

/**
 * Read from and/or write to a JSON file "next to" the pathname given to the
 * constructor.
 *
 * The JSON file will will have a `.json` extension and be located in the same
 * directory as the specified pathname. By default it will have the same base
 * name (filename without final extension) as the specified pathname, but a
 * modification function can be given to modify the name used.
 *
 * For example, given a pathname like `foo/bar/Your Program.js`, the default
 * JSON file will be `foo/bar/Your Program.json`, but a filename modification
 * function could add `' log'` to change it to `foo/bar/Your Program log.json`.
 */
class SideStore {
  private pathname: string;
  constructor(pathname: string, modifyFilename?: (basename: string) => string) {
    const lfm = FileManager.local();

    lfm.isFileStoredIniCloud(pathname);
    const dir = dirname(pathname);
    const basename = lfm.fileName(pathname);
    const newBasename = modifyFilename?.(basename) ?? basename;
    this.pathname = lfm.joinPath(dir, newBasename + '.json');
  }
  public data: unknown;
  read(): void {
    const fm = FileManager.local();
    if (fm.fileExists(this.pathname))
      this.data = JSON.parse(fm.readString(this.pathname));
    else
      this.data = null;
  }
  write(): void {
    FileManager.local().writeString(this.pathname, JSON.stringify(this.data));
  }
}

// platform independent definitions (maybe UI could be web-based inside a WebView)

import { AllEditionsServices, type EditionsService } from 'utils';

type IO = { type: 'clipboard' } | { type: 'file', displayName: string };
type Input = IO & { info: { items: number, shelfItems: Record<string, number> } };
type MissingISBNsSummary = { name: 'MissingISBNs', itemsMissingISBN: number };
type GetISBNsSummary = {
  name: 'GetISBNs', editionsInfo?: { [k in EditionsService]?: {
    cacheHits: number,
    queries: number,
    fetches: number,
    fetchRate: number,
    fetchStats: { min: number, median: number, max: number }
  } }, totalISBNs: number
};
type CommandSummary = MissingISBNsSummary | GetISBNsSummary;
interface UI {
  input(input: Input): void,
  commandProgressTotal(total: number): void,
  commandProgress(done: number): void,
  commandSummary(summary: CommandSummary): void,
  // output(output: IO): void,
  getSavableData?(): unknown,
}

type RequestedIO = { type: 'clipboard' } | { type: 'file' };
type MissingISBNs = { name: 'MissingISBNs', shelf: string };
type GetISBNs = { name: 'GetISBNs', shelf: string, both: boolean, editions: EditionsService[] };
type Command = MissingISBNs | GetISBNs;
interface UIRequestReceiver {
  requestInput(ui: UI, input: RequestedIO): void,
  requestCommand(ui: UI, command: Command): void,
  // requestSaveOutput(output:RequestIO), // calls ui.output()
}

// UITable-based UI uses controller to do the work

type Optional<T, OP extends PropertyKey> =
  { [required in Exclude<keyof T, OP>]-?: T[required] }
  & { [optional in Extract<keyof T, OP>]?: T[optional] };
type PartialMissingISBNs = Optional<MissingISBNs, 'shelf'>;
type PartialGetISBNs = Optional<GetISBNs, 'shelf'>;
type PartialCommand = PartialMissingISBNs | PartialGetISBNs;
type Progress = { total: number, done: number };
type UIState =
  | {
    input?: undefined,
    command?: undefined,
    ready?: undefined,
    progress?: undefined,
    summary?: undefined,
  }
  | {
    input: Input,
    command?: undefined,
    ready?: undefined,
    progress?: undefined,
    summary?: undefined,
  }
  | {
    input: Input,
    command: PartialCommand,
    ready?: undefined,
    progress?: undefined,
    summary?: undefined,
  }
  | {
    input: Input,
    command: Command,
    ready: true,
    progress?: undefined,
    summary?: undefined,
  }
  | {
    input: Input,
    command: Command,
    ready: true,
    progress: Progress,
    summary?: undefined,
  }
  | {
    input: Input,
    command: Command,
    ready: true,
    progress: Progress,
    summary: CommandSummary,
  }
  ;
type ByNames<T extends { name: PropertyKey }> = { [N in T['name']]: Extract<T, { name: N }> };

class UITableUI implements UI {
  private table: UITable = new UITable;
  private presented = false;
  private state: UIState = {};
  constructor(private controller: UIRequestReceiver, restoredData: unknown) {
    if (typeof restoredData == 'object' && restoredData) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      // XXX validation typanion?
      if ('command' in restoredData)
        this.previousCommand = restoredData.command as any;
      if ('commands' in restoredData)
        this.previousCommands = restoredData.commands as any;
      /* eslint-enable */
    }
    this.build();
  }
  getSavableData(): unknown {
    this.saveState();
    return {
      commands: this.previousCommands,
      command: this.previousCommand,
    };
  }
  input(input: Input): void {
    this.setInput(input);
  }
  private setInput(input?: Input) {
    this.saveState();
    this.state = this.validateState(input, true);
    this.build();
  }
  private previousInput?: Input;
  private previousCommands: Partial<ByNames<PartialCommand>> = {};
  private previousCommand?: keyof typeof this.previousCommands;
  private saveState() {

    if (!this.state.input) return;

    this.previousInput = this.state.input;

    if (!this.state.command) return;

    let commandToSave = this.state.command;
    const name = commandToSave.name;

    this.previousCommand = name;

    const previousShelf = this.previousCommands[name]?.shelf;
    if (typeof commandToSave.shelf == 'undefined' && typeof previousShelf != 'undefined')
      commandToSave = { ...commandToSave, shelf: previousShelf };

    if (name == 'MissingISBNs')
      this.previousCommands[name] = commandToSave;
    else if (name == 'GetISBNs')
      this.previousCommands[name] = commandToSave;
    else
      assertNever(name);
  }
  private validateState(input?: Input, restorePrevious = false, command?: PartialCommand, progress?: Progress, summary?: CommandSummary): UIState {

    const validatedShelf = (input: Input, shelf?: string) => {
      if (typeof shelf == 'undefined')
        return void 0;
      if (Object.hasOwn(input.info.shelfItems, shelf))
        return shelf;
    };

    if (!input) return { input: void 0 };

    if (!command) {

      if (!restorePrevious) return { input };

      command = this.previousCommand ? this.previousCommands[this.previousCommand] : void 0;
      if (!command) return { input };
    }

    if (restorePrevious) {
      if (command.name == 'MissingISBNs') {
        const previousCommand = this.previousCommands[command.name];
        command.shelf = validatedShelf(input, command.shelf ?? previousCommand?.shelf);
      } else if (command.name == 'GetISBNs') {
        const previousCommand = this.previousCommands[command.name];
        command.shelf = validatedShelf(input, command.shelf ?? previousCommand?.shelf);
        if (previousCommand) {
          command.both = previousCommand.both;
          command.editions = previousCommand.editions;
        }
      } else assertNever(command);
    }

    function validateReadyCommand(command: PartialCommand): Command | undefined {
      if (typeof command.shelf == 'undefined') return void 0;
      return { ...command, shelf: command.shelf };
    }

    const readyCommand = validateReadyCommand(command);
    if (!readyCommand)
      return { input, command };

    if (!progress)
      return { input, command: readyCommand, ready: true };

    if (!summary)
      return { input, command: readyCommand, ready: true, progress };

    return { input, command: readyCommand, ready: true, progress, summary };
  }
  private build() {
    this.table.removeAllRows();
    this.table.showSeparators = true;

    const title = new UITableRow;
    title.addText('Goodreads Export Tool').centerAligned();
    title.isHeader = true;
    this.table.addRow(title);

    this.table.addRow(new UITableRow);

    this.buildInput();

    // command only builds if state.input
    this.buildCommand();

    // run only builds if state.ready && !state.progress && !state.summary
    this.buildRun();

    // progress only builds if state.progress && !state.summary
    this.buildProgress();

    // summary & output only build if state.summary
    this.buildSummary();
    this.buildOutput();

    if (this.presented) this.table.reload();
  }
  private buildInput(): void {
    const text = 'Input XXX';
    const pickInput = () => this.setInput(void 0);
    if (!this.state.input) {

      this.buildSection(text, this.previousInput && { onSelect: () => this.setInput(this.previousInput) });
      this.buildAction('the clipboard', () => this.controller.requestInput(this, { type: 'clipboard' }));
      this.buildAction('a file…', () => this.controller.requestInput(this, { type: 'file' }));

    } else if (this.state.input.type == 'clipboard') {

      this.buildSection(text, { value: 'the clipboard', hint: 'tap to change…', onSelect: pickInput });
      const info = this.state.input.info;
      this.buildSection(`${info.items} items`);

    } else if (this.state.input.type == 'file') {

      this.buildSection(text, { value: `the file "${this.state.input.displayName}"`, hint: 'tap to change…', onSelect: pickInput });
      const info = this.state.input.info;
      this.buildSection(`${info.items} items`);

    } else assertNever(this.state.input);
  }
  private setCommand(command?: PartialCommand, restorePrevious = false) {
    this.saveState();
    this.state = this.validateState(this.state.input, restorePrevious, command);
    this.build();
  }
  private buildCommand() {
    if (!this.state.input) return;
    const text = 'Command XXX';
    const pickCommand = () => this.setCommand(void 0, false);
    if (!this.state.command) {

      this.buildSection(text, this.previousCommand && { onSelect: () => this.previousCommand && this.setCommand(this.previousCommands[this.previousCommand]) });
      this.buildAction('MissingISBNs XXX', () => this.setCommand({ name: 'MissingISBNs' }, true));
      this.buildAction('GetISBNs XXX', () => this.setCommand({ name: 'GetISBNs', both: false, editions: [] }, true));

    } else if (this.state.command.name == 'MissingISBNs') {

      this.buildSection('MissingISBNs XXX', { hint: 'tap to change…', onSelect: pickCommand });
      this.buildShelf();

    } else if (this.state.command.name == 'GetISBNs') {

      this.buildSection('GetISBNs XXX', { hint: 'tap to change…', onSelect: pickCommand });
      this.buildShelf();

      const command = this.state.command;
      const editionsEnabled = command.editions.length != 0;
      const editionsText = editionsEnabled ? 'Get ISBNs of Other Editions' : 'Get Only Listed ISBNs (no other editions)';
      const editionsToggle = () => this.setCommand({ ...command, editions: editionsEnabled ? [] : Array.from(AllEditionsServices) });
      const bothText = command.both ? 'Get Both ISBN-10 and -13' : 'Get Only One Of ISBN-13, ISBN-10';
      const bothToggle = () => this.setCommand({ ...command, both: !command.both });
      const serviceToggle = (service: EditionsService) => {
        let editions;
        if (command.editions.includes(service))
          editions = command.editions.filter(s => s != service);
        else
          editions = command.editions.concat([service]);
        this.setCommand({ ...command, editions });
      };

      this.buildSection('Options');
      this.buildAction(editionsText, editionsToggle);
      if (editionsEnabled)
        AllEditionsServices.forEach(service => {
          const enabled = command.editions.includes(service);
          return this.buildAction(service + ': ' + (enabled ? 'enabled' : 'disabled'), () => serviceToggle(service as EditionsService));
        });
      this.buildAction(bothText, bothToggle);

    } else assertNever(this.state.command);
  }
  private buildShelf(): void {
    if (!this.state.command) return;
    if (this.state.command.shelf) {

      const noShelf = { ...this.state.command, shelf: void 0 };
      this.buildSection('Shelf', { value: this.state.command.shelf, hint: 'tap to change…', onSelect: () => this.setCommand(noShelf) });

    } else {

      const withPreviousShelf = { ...this.state.command, shelf: this.previousCommands[this.state.command.name]?.shelf };
      const canRevert = typeof withPreviousShelf.shelf != 'undefined' || void 0;
      this.buildSection('Select a Shelf', canRevert && { onSelect: () => this.setCommand(withPreviousShelf) });
      const shelfItems = this.state.input.info.shelfItems;
      Object.getOwnPropertyNames(shelfItems)
        .forEach(shelf => {
          const row = this.buildAction(shelf, () => this.setCommand({ ...withPreviousShelf, shelf }), 85);
          row.cellSpacing = 10;
          const x = row.addText(String(shelfItems[shelf]));
          x.widthWeight = 15;
        });

    }
  }
  private buildRun() {
    if (!this.state.ready || this.state.progress || this.state.summary) return;
    const command = this.state.command;
    this.buildSection('Run XXX', { onSelect: () => this.controller.requestCommand(this, command) });
  }
  private buildProgress() {
    if (!this.state.progress || this.state.summary) return;
    this.buildSection('Progress XXX');
    this.buildAction(`${this.state.progress.done}/${this.state.progress.total}`);
  }
  private setProgress(progress: Progress) {
    this.saveState();
    this.state = this.validateState(this.state.input, false, this.state.command, progress);
    this.build();
  }
  commandProgressTotal(total: number): void {
    this.setProgress({ total, done: 0 });
  }
  commandProgress(done: number): void {
    if (!this.state.progress) return;
    this.setProgress({ ...this.state.progress, done });
  }
  commandSummary(summary: CommandSummary) {
    this.setSummary(summary);
  }
  private setSummary(summary: CommandSummary) {
    this.saveState();
    this.state = this.validateState(this.state.input, false, this.state.command, this.state.progress ?? { total: 0, done: 0 }, summary);
    this.build();
  }
  private buildSummary() {
    if (!this.state.summary) return;

    this.buildSection('Summary XXX');

    const summary = this.state.summary;

    if (summary.name == 'MissingISBNs') {
      const shelf = this.state.command.shelf;
      const items = this.state.input.info.shelfItems[shelf] ?? -1;
      ([
        [`"${shelf}" Items:`, items],
        ['Items Missing an ISBN:', summary.itemsMissingISBN],
      ] as const).forEach(([desc, value]) => {
        const row = this.buildAction(desc, void 0, 9);
        const cell = row.addText(String(value));
        cell.widthWeight = 1;
      });
    } else if (summary.name == 'GetISBNs') {
      const shelf = this.state.command.shelf;
      const items = this.state.input.info.shelfItems[shelf] ?? -1;
      ([
        [`"${shelf}" Items:`, items],
        ['Final ISBN Count:', summary.totalISBNs],
      ] as const).forEach(([desc, value]) => {
        const row = this.buildAction(desc, void 0, 85);
        const cell = row.addText(String(value));
        cell.widthWeight = 15;
      });
      const short: Record<EditionsService, string> = {
        'Open Library WorkEditions': 'OL:WE',
        'Open Library Search': 'OL:S',
        'LibraryThing ThingISBN': 'LT:TI',
      };
      if (summary.editionsInfo) {
        const info = summary.editionsInfo;
        const services = Object.keys(info) as EditionsService[];
        ([
          ['', ...services.map(s => short[s as EditionsService])],
          [`Cached Queries:`, ...services.map(service => info[service]?.cacheHits)],
          [`Queries:`, ...services.map(service => info[service]?.queries)],
          [`Fetches:`, ...services.map(service => info[service]?.fetches)],
          [`Fetch Rate (/s):`, ...services.map(service => info[service]?.fetchRate.toFixed(3))],
          [`Fastest Fetch (ms):`, ...services.map(service => info[service]?.fetchStats.min)],
          [`Median Fetch (ms):`, ...services.map(service => info[service]?.fetchStats.median)],
          [`Slowest Fetch (ms):`, ...services.map(service => info[service]?.fetchStats.max)],
        ] as const).forEach(([desc, a, b, c]) => {
          const row = this.buildAction(desc, void 0, 100 - 15 * 3 - 5);
          const space = row.addText('');
          space.widthWeight = 5;
          const cell = (v: number | string) => {
            const c = row.addText(String(v));
            c.widthWeight = 15;
          };
          cell(a ?? '');
          cell(b ?? '');
          cell(c ?? '');
        });
      }

    } else assertNever(summary);
  }
  private buildOutput() {
    if (!this.state.summary) return;
    this.buildSection('Output XXX');
  }
  private buildRow(onSelect?: () => void) {
    const row = new UITableRow;
    if (onSelect) {
      row.onSelect = onSelect;
      row.dismissOnSelect = false;
    }
    this.table.addRow(row);
    return row;
  }
  private buildSection(description: string, opts: { onSelect?: () => void, value?: string, hint?: string } = {}) {
    const header = this.buildRow(opts.onSelect);
    header.addText(description);
    if (opts.value || opts.hint)
      header.addText(opts.value ?? ' ', opts.hint).rightAligned();
    return header;
  }
  private buildAction(value: string, onSelect?: () => void, weight?: number) {
    const action = this.buildRow(onSelect);
    const cell = action.addText(value);
    cell.rightAligned();
    if (weight)
      cell.widthWeight = weight;
    return action;
  }
  present(...args: Parameters<UITable['present']>): ReturnType<UITable['present']> {
    this.presented = true;
    return this.table.present(...args);
  }
}

// controller interfaces with tool-core on behalf of a non-specific UI

import { type CacheData, type FetchResult, getISBNs, missingISBNs, shelfInfo } from 'utils';

class Controller implements UIRequestReceiver {
  private cache: CacheData;
  constructor(cache: unknown) {
    if (isStore(cache))
      this.cache = cache;
    else
      this.cache = {};
  }
  private csv?: string;
  async requestInput(ui: UI, inputReq: RequestedIO): Promise<void> {

    const { csv, input } = await getInput();
    this.csv = csv;
    Timer.schedule(250, false, () => ui.input(input));

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
        const fm = FileManager.local();
        const csv = fm.readString(pathname);
        return { csv, input: { type, displayName: fm.fileName(pathname), info: await getInputInfo(csv) } };

      } else assertNever(type);

      throw `unhandled input request type: ${type}`;
    }
    async function getInputInfo(csv: string): Promise<Input['info']> {
      const { exclusive, shelfCounts } = await shelfInfo(csv);
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
  async requestCommand(ui: UI, command: Command): Promise<void> {
    if (!this.csv) throw 'requested command without first requesting input';
    let summary: CommandSummary;
    summary_ready:
    if (command.name == 'MissingISBNs') {

      const rows = await missingISBNs(this.csv, command.shelf);
      summary = { name: 'MissingISBNs', itemsMissingISBN: rows.length };

    } else if (command.name == 'GetISBNs') {

      console.log('get');
      let isbnsDone = 0;
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
          cacheData: this.cache,
          fetcher: fakeFetcher,
          reporter: report => {
            const ev = report.event;
            if (ev == 'rejection') {
              console.error(report.reason);
            } else if (ev == 'service cache hit') {
              infoFor(report.service).hits++;
            } else if (ev == 'query plan') {
              const count = Array.from(report.plan.values()).reduce((total, isbns) => total + isbns.size, 0);
              ui.commandProgressTotal(count);
            } else if (ev == 'service query started') {
              const info = infoFor(report.service);
              if (!info.firstBegan) info.firstBegan = Date.now();
              info.queries++;
            } else if (ev == 'fetch started') {
              console.log(`started ${report.url}`);
            } else if (ev == 'fetch finished') {
              infoFor(report.service).fetches.push(report.elapsed);
            } else if (ev == 'service query finished') {
              infoFor(report.service).lastEnded = Date.now();
              ui.commandProgress(++isbnsDone);
              report.warnings; // XXX
              report.faults; // XXX
            }
          }
        },
        bothISBNs: command.both,
      });
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
    else assertNever(command);

    Timer.schedule(250, false, () => ui.commandSummary(summary));
  }
  getCached(): CacheData {
    return this.cache;
  }
}

import { equivalentISBNs } from 'utils';

// generate fake data for the "editions of" parsers to consume so we do not make real requests while testing
async function fakeFetcher(url: string): Promise<FetchResult> {
  const randomInt = (n: number) => Math.trunc(Math.random() * n);
  await new Promise<void>(res => Timer.schedule(randomInt(200) * 1 + 200, false, res));
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

function isStore(o: unknown): o is Record<string, unknown> {
  if (!o) return false;
  if (typeof o != 'object') return false;
  return true;
}

// setTimeout used by throttle
declare const globalThis: Record<PropertyKey, unknown>;
globalThis.setTimeout = <A extends unknown[]>(fn: (...args: A) => void, ms: number, ...args: A): Timer => {
  if (typeof fn == 'string') throw 'setTimeout with uncompiled code argument not supported';
  return Timer.schedule(ms, false, () => fn(...args));
};
// globalThis.clearTimeout = (timer: Timer): void => timer.invalidate();

const store = new SideStore(module.filename);
store.read();
if (!store.data) store.data = {};
if (!isStore(store.data)) throw 'restored data is not an object?';

const controller = new Controller(store.data.EditionsCache);
const ui = new UITableUI(controller, store.data.UITableUIData);

await ui.present(true);
store.data.UITableUIData = ui.getSavableData();
store.data.EditionsCache = controller.getCached();
store.write();

// (known) BUGS

// TODO
// with only OLWE enabled, progress appears only sporadically: no apparent progress while (10) queued works finish before editions can be finished and show progress then another delay while a new batch of works is processed before any editions
//  probably explains the minor progress jitter that I've seen before (the queue get more than a few works queued, and they won't show progress until their editions finish, too)
//  show finished,active,waiting=total instead of just done/total
// AllEditionsServices (part of utils) is now coupled to UI, move it to controller or main and have it passed in?
// warnings and faults from 'service query finished'
//  log into another (plain text, not JSON?) file
// during run
//  make UI non-interactive (except a cancel button?)
//    no onSelects, no "tap to" hints
// handle "canceled" operation?
//  .then (or separate async "thread" await) the actual present() promise
//  make fetches start rejecting to finish as quickly as possible
//  replace our present()'s promise to keep it unresolved until getISBNs finishes
//    otherwise, Scriptable might not know something is still running
//    return (async ()=>{await this.table.present();await this.finishCommand();})()
//    return this.table.present().then(()=>this.finishCommand())
// bar graph for progress?
// output
//  missing: pick columns, or just use the same set at the node tool?
//  save to file (DocumentPicker.export)
//  clipboard (Pasteboard.copyString)
//  view (quick look?)
// store cache separately from other saved stuff?
//  otherwise, hard to clear cache without deleting other saved stuff
//    nothing too important is saved though, really
//  test mode will probably force moving cache management into controller...
// debug tools "screen'
//  maybe an overlay present()able so we don't have to muck with UI state
//    would be mostly delegated to controller anyway since that is where this stuff "lives"
//  clear cache
//  view cache summary?
//  view fault log?
//  test mode toggle here?
//    (with warning on GetISBNs editions: true run if enabled)
//      hmm, since debug is controller-based, would need a controller->ui notification which is a new coupling type (existing are all "callbacks": the controller does not know about the UI outside of a UI-initiated request)
//    could just not have anything in the main UI... maybe a bool in the editionInfo to inform after the fact
//      controller could pop an Alert with Proceed/Cancel buttons if test mode is "unexpected" (expect false in "production", true in "development")
// test mode
//  only GetISBNs editions:true needs it currently, so have it show up as option in only that case?
//  user-controlled in UI, but effected by controller, but not entirely...
//    cache location is determined outside controller currently
//      pass two cache locations (one for test, one for real)?
//      move cache storage management into controller?
//        it already does platform specific stuff (IO), not just interfacing with tool-core, so a bit more (through SideStore, or similar) is NBD
//        it doesn't know when UI is done presenting, but it could save after every command
//        would naturally force separation of UI saved data and cached data
//        once entirely managed by controller, test mode can be an option in just GetISBNs (or other commands if anything else eventually needs a test mode)
//          so UI doesn't have to coordinate switching back and forth based on UI actions, just the effective setting when the command is actually run
//  switch cache location and fetcher
//  save its state in the saved data?
//  really only GetISBNs editions:true uses it, so make it an option for only that case?
//    maybe only if "hidden" toggle is also enabled?
//      force it if "hidden" bit is on? or just present it as an option if "hidden" bit is on?
//  "hidden" part of UI to put it?
//    table UI
//      invisible button in the middle of the blank row?
//        turns visible when enabled, to make it easy to notice and turn off
//    in navigation controller -style UI
//      invisible UR corner of Run; visible when enabled
// real fetcher
// new input type: Scriptable bookmark
//  probably not useful for one-off users, but should be useful for frequent runs while developing
//  provide a one-tap way to use a previously selected bookmark
//    avoids the extra step of having to pick a bookmark (or go through DocumentPicker) to use a commonly used file
// maybe we can accurately track "currentlyPresenting" if we keep the original promise value (and null it out when it resolves)
//  might be needed if we have to dismiss the UI and re-present it to let the controller do its file prompting?
//    controller can do DocumentPicker and Alert without dismissing the presented UITable UI
// collapse input UI after selection, before input() comes back
//  so UI responds right away, to avoid extra tapping if the response is delayed
//  make UI non-interactive and provide progress?
// updateExceptUndefined
//  helper for saveState updating previousCommands to not overwrite a non-undefined shelf with undefined
// ? move building into separate builder class to avoid headerRow, actionRow, etc. on UI class?

// STYLING
// "tap to <use previous value>" hint in open menus: Input XXX, Command XXX, Select a Shelf
//  style previous value differently and match it in the hint?
// styling? default in dark mode is white on black, buttons are blue on black header is bold
//  something special for "need to pick something here"?
// typical UI names for input and output
//  Open and Save (open not typically applied to clipboard...)
// long description when first starting (togglable via empty row?)

// FUTURE
// redo UI as "screen"-based instead of row-based
//  can we have multi-line (i.e. wrapped) texts in a UITable?
//    if not, this UI style loses some of its appeal, but still might be worth it to give some extra room for shelf lists and summaries
//  like an iOS navigation controller
//  gives much more space for informational/descriptive text
//  have "back" button on left of first row
//  action rows push a new screen
//    screens probably correspond to the UIState stages
// break shelves into exclusive & other?
//  then, let the UI do the sorting?
// summary (and output) are kind of fragile, would be discarded after any change in input or command
//  "cache" the last run command and restore its summary if the command is the same?
//  really, this is related to the controller, since it is holding the result data? (ui only sees summary info, and possibly issues "save" request)
//    maybe the controller caches (probably just in memory, not persistently) one-per-command arguments & output
//      if command "run" again with same command and arguments as cached, just return the cached output?
//        this means we can't to back-to-back GetISBNs w/editions fetches; would have to stop and restart the script in Scriptable to flush this "output cache"
