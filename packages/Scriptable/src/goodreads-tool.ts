// Scriptable front end for tool-core

// TypeScript generic stuff

function assertNever(value: never): never { void value; throw 'assertNever called' }

// Scriptable generic stuff

function dirname(path: string) {
  const lfm = FileManager.local();
  const filename = lfm.fileName(path, true);
  if (!path.endsWith(filename)) throw 'path does not end with extracted filename!?';
  const dirSlash = path.slice(0, path.length - filename.length);
  return dirSlash.replace(/[/]*$/, '');
}

/**
 * Generate a pathname (with the given extension) "next to" the given pathname.
 *
 * The generated pathname will be located in the same directory as the specified
 * pathname. By default it will have the same base name (filename without final
 * extension) as the specified pathname, but a modification function can be
 * given to modify the name used.
 *
 * For example, given a pathname like `foo/bar/Your Program.js`, and the
 * extension `json`, the generated pathname will be `foo/bar/Your Program.json`.
 * A filename modification function could add `' log'` to change it to
 * `foo/bar/Your Program log.json`.
 */
function asidePathname(pathname: string, ext: string, modifyBasename?: (basename: string) => string) {
  const fm = FileManager.local();
  const dir = dirname(pathname);
  const basename = fm.fileName(pathname);
  const newBasename = modifyBasename?.(basename) ?? basename;
  return fm.joinPath(dir, newBasename + '.' + ext);
}

class Store {
  private rw: ReadWrite;
  constructor(pathname: string) {
    this.rw = new ReadWrite(pathname);
  }
  public data: unknown;
  async read(): Promise<void> {
    if (await this.rw.exists())
      this.data = JSON.parse(await this.rw.readString());
    else
      this.data = null;
  }
  async write(): Promise<void> {
    this.rw.writeString(JSON.stringify(this.data));
  }
}

class Log {
  private rw: ReadWrite;
  constructor(pathname: string) {
    this.rw = new ReadWrite(pathname);
  }
  private log: string[] = [];
  append(line: string) {
    this.log.push(line);
  }
  async flush(): Promise<void> {
    if (this.log.length > 0) {
      const logs = this.log.splice(0);
      await this.rw.writeString(await this.rw.readString() + logs.join('\n') + '\n');
    }
  }
}

class ReadWrite {
  constructor(private pathname: string) { }
  async exists(): Promise<boolean> {
    return FileManager.local().fileExists(this.pathname);
  }
  async read(): Promise<Data> {
    const fm = FileManager.local();
    if (fm.fileExists(this.pathname)) {
      await fm.downloadFileFromiCloud(this.pathname);
      return fm.read(this.pathname);
    }
    return Data.fromString('');
  }
  async write(data: Data): Promise<void> {
    FileManager.local().write(this.pathname, data);
  }
  async readString(): Promise<string> {
    return (await this.read()).toRawString();
  }
  async writeString(str: string) {
    return this.write(Data.fromString(str));
  }
}

// platform independent definitions (maybe UI could be web-based inside a WebView)

import { AllEditionsServices, type Fetcher, type EditionsService } from 'utils';

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
  commandProgress(progress: { total: number, started: number, done: number, fetched: number }): void,
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

// helper that builds common patterns of UITable elements
class UITableBuilder {
  constructor(private table: UITable) { }
  private buildRow(onSelect?: () => void) {
    const row = new UITableRow;
    if (onSelect) {
      row.onSelect = onSelect;
      row.dismissOnSelect = false;
    }
    this.table.addRow(row);
    return row;
  }
  addSectionRow(description: string, opts: { onSelect?: () => void, value?: string, hint?: string } = {}): UITableRow {
    const header = this.buildRow(opts.onSelect);
    header.addText(description);
    if (opts.value || opts.hint)
      header.addText(opts.value ?? ' ', opts.hint).rightAligned();
    return header;
  }
  addActionRow(value: string, onSelect?: () => void, weight?: number): UITableRow {
    const action = this.buildRow(onSelect);
    const cell = action.addText(value);
    cell.rightAligned();
    if (weight)
      cell.widthWeight = weight;
    return action;
  }
}

// UITable-based UI uses controller to do the work

type Optional<T, OP extends PropertyKey> =
  { [required in Exclude<keyof T, OP>]-?: T[required] }
  & { [optional in Extract<keyof T, OP>]?: T[optional] };
type PartialMissingISBNs = Optional<MissingISBNs, 'shelf'>;
type PartialGetISBNs = Optional<GetISBNs, 'shelf'>;
type PartialCommand = PartialMissingISBNs | PartialGetISBNs;
type Progress = { total: number, started: number, done: number, fetched: number };
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
  private builder = new UITableBuilder(this.table);
  private presented = false;
  private state: UIState = {};
  constructor(private controller: UIRequestReceiver, private savedDataObject: unknown) {
    if (typeof this.savedDataObject == 'object' && this.savedDataObject) {
      const restoredData = this.savedDataObject;
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

      this.builder.addSectionRow(text, this.previousInput && { onSelect: () => this.setInput(this.previousInput) });
      this.builder.addActionRow('the clipboard', () => this.controller.requestInput(this, { type: 'clipboard' }));
      this.builder.addActionRow('a file…', () => this.controller.requestInput(this, { type: 'file' }));

    } else if (this.state.input.type == 'clipboard') {

      this.builder.addSectionRow(text, { value: 'the clipboard', hint: 'tap to change…', onSelect: pickInput });
      const info = this.state.input.info;
      this.builder.addSectionRow(`${info.items} items`);

    } else if (this.state.input.type == 'file') {

      this.builder.addSectionRow(text, { value: `the file "${this.state.input.displayName}"`, hint: 'tap to change…', onSelect: pickInput });
      const info = this.state.input.info;
      this.builder.addSectionRow(`${info.items} items`);

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

      this.builder.addSectionRow(text, this.previousCommand && { onSelect: () => this.previousCommand && this.setCommand(this.previousCommands[this.previousCommand]) });
      this.builder.addActionRow('MissingISBNs XXX', () => this.setCommand({ name: 'MissingISBNs' }, true));
      this.builder.addActionRow('GetISBNs XXX', () => this.setCommand({ name: 'GetISBNs', both: false, editions: [] }, true));

    } else if (this.state.command.name == 'MissingISBNs') {

      this.builder.addSectionRow('MissingISBNs XXX', { hint: 'tap to change…', onSelect: pickCommand });
      this.buildShelf();

    } else if (this.state.command.name == 'GetISBNs') {

      this.builder.addSectionRow('GetISBNs XXX', { hint: 'tap to change…', onSelect: pickCommand });
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

      this.builder.addSectionRow('Options');
      this.builder.addActionRow(editionsText, editionsToggle);
      if (editionsEnabled)
        AllEditionsServices.forEach(service => {
          const enabled = command.editions.includes(service);
          return this.builder.addActionRow(service + ': ' + (enabled ? 'enabled' : 'disabled'), () => serviceToggle(service as EditionsService));
        });
      this.builder.addActionRow(bothText, bothToggle);

    } else assertNever(this.state.command);
  }
  private buildShelf(): void {
    if (!this.state.command) return;
    if (this.state.command.shelf) {

      const noShelf = { ...this.state.command, shelf: void 0 };
      this.builder.addSectionRow('Shelf', { value: this.state.command.shelf, hint: 'tap to change…', onSelect: () => this.setCommand(noShelf) });

    } else {

      const withPreviousShelf = { ...this.state.command, shelf: this.previousCommands[this.state.command.name]?.shelf };
      const canRevert = typeof withPreviousShelf.shelf != 'undefined' || void 0;
      this.builder.addSectionRow('Select a Shelf', canRevert && { onSelect: () => this.setCommand(withPreviousShelf) });
      const shelfItems = this.state.input.info.shelfItems;
      Object.getOwnPropertyNames(shelfItems)
        .forEach(shelf => {
          const row = this.builder.addActionRow(shelf, () => this.setCommand({ ...withPreviousShelf, shelf }), 85);
          row.cellSpacing = 10;
          const x = row.addText(String(shelfItems[shelf]));
          x.widthWeight = 15;
        });

    }
  }
  private buildRun() {
    if (!this.state.ready || this.state.progress || this.state.summary) return;
    const command = this.state.command;
    this.builder.addSectionRow('Run XXX', { onSelect: () => this.controller.requestCommand(this, command) });
  }
  private buildProgress() {
    if (!this.state.progress || this.state.summary) return;
    const { total, started, done, fetched } = this.state.progress;
    const waiting = total - started;
    const active = started - done;
    this.builder.addSectionRow('Progress XXX');
    this.builder.addActionRow(`${fetched} fetched`);
    this.builder.addActionRow(`${done} done + ${active} active + ${waiting} waiting = ${total}`);
  }
  private setProgress(progress: Progress) {
    this.saveState();
    this.state = this.validateState(this.state.input, false, this.state.command, progress);
    this.build();
  }
  commandProgress(progress: { total: number, started: number, done: number, fetched: number }): void {
    this.setProgress(progress);
  }
  commandSummary(summary: CommandSummary) {
    this.setSummary(summary);
  }
  private setSummary(summary: CommandSummary) {
    this.saveState();
    this.state = this.validateState(this.state.input, false, this.state.command, this.state.progress ?? { total: 0, started: 0, done: 0, fetched: 0 }, summary);
    this.build();
  }
  private buildSummary() {
    if (!this.state.summary) return;

    this.builder.addSectionRow('Summary XXX');

    const summary = this.state.summary;

    if (summary.name == 'MissingISBNs') {
      const shelf = this.state.command.shelf;
      const items = this.state.input.info.shelfItems[shelf] ?? -1;
      ([
        [`"${shelf}" Items:`, items],
        ['Items Missing an ISBN:', summary.itemsMissingISBN],
      ] as const).forEach(([desc, value]) => {
        const row = this.builder.addActionRow(desc, void 0, 9);
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
        const row = this.builder.addActionRow(desc, void 0, 85);
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
          const row = this.builder.addActionRow(desc, void 0, 100 - 15 * 3 - 5);
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
    this.builder.addSectionRow('Output XXX');
  }
  async present(...args: Parameters<UITable['present']>): ReturnType<UITable['present']> {
    this.presented = true;
    try {
      return await this.table.present(...args);
    } finally {
      this.presented = false;
      this.saveState();
      this.savedDataObject = {
        commands: this.previousCommands,
        command: this.previousCommand,
      };
    }
  }
}

// controller interfaces with tool-core on behalf of a non-specific UI

import { type FetchResult, getISBNs, missingISBNs, shelfInfo } from 'utils';

class Controller implements UIRequestReceiver {
  private log: Log;
  constructor(logPathname: string, private cachePathname: string, private testCachePathname: string) {
    this.log = new Log(logPathname);
  }
  private csv?: string;
  async requestInput(ui: UI, inputReq: RequestedIO): Promise<void> {

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
  private async _requestCommand(ui: UI, command: Command): Promise<void> {
    if (!this.csv) throw 'requested command without first requesting input';
    let summary: CommandSummary;
    summary_ready:
    if (command.name == 'MissingISBNs') {

      const rows = await missingISBNs(this.csv, command.shelf);
      summary = { name: 'MissingISBNs', itemsMissingISBN: rows.length };

    } else if (command.name == 'GetISBNs') {

      const testMode = true;

      const fetcher: Fetcher = (fetcher => {
        return url => {
          if (this.abortingFetches) return Promise.reject(`aborting ${url}`);
          return fetcher(url);
        };
      })(testMode ? fakeFetcher : () => Promise.reject('real fetcher not implemented!'));

      const store = new Store(testMode ? this.testCachePathname : this.cachePathname);
      await store.read();
      const cacheData = (store => {
        if (!store) return void 0;
        if (isStore(store.data))
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
            const ev = report.event;
            if (ev == 'abort fn') {
              this.abortEditions = report.fn;
            } else if (ev == 'rejection') {
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
                this.log.append(e.description);
              });
              report.faults.forEach(e => {
                console.warn(e.description);
                this.log.append(e.description);
              });
            }
          }
        },
        bothISBNs: command.both,
      });

      await store.write();

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

    await this.log.flush();

    ui.commandSummary(summary);
  }
  async abortIfRunning() {
    this.abortingFetches = true;
    this.abortEditions?.();
    await this.commandPromise;
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

// setTimeout and clearTimeout used by throttle
declare const globalThis: Record<PropertyKey, unknown>;
globalThis.setTimeout = <A extends unknown[]>(fn: (...args: A) => void, ms: number, ...args: A): Timer => {
  if (typeof fn == 'string') throw 'setTimeout with uncompiled code argument not supported';
  return Timer.schedule(ms, false, () => fn(...args));
};
globalThis.clearTimeout = (timer: Timer): void => timer.invalidate();

const store = new Store(asidePathname(module.filename, 'json'));
await store.read();
if (!store.data) store.data = {};
if (!isStore(store.data)) throw 'restored data is not an object?';

const logPathname = asidePathname(module.filename, 'log');
const cachePathname = asidePathname(module.filename, 'json', bn => bn + ' cache');
const testCachePathname = asidePathname(module.filename, 'json', bn => bn + ' test cache');

const controller = new Controller(logPathname, cachePathname, testCachePathname);

const ui = new UITableUI(controller, store.data.UITableUIData);
await ui.present(true);
await controller.abortIfRunning();

await store.write();

// (known) BUGS

// TODO
// AllEditionsServices (part of utils) is now coupled to UI, move it to controller or main and have it passed in?
// during run
//  make UI non-interactive (except a cancel button?)
//    no onSelects, no "tap to" hints
// bar graph for progress?
// output
//  missing: pick columns, or just use the same set at the node tool?
//  save to file (DocumentPicker.export)
//  clipboard (Pasteboard.copyString)
//  view (quick look?)
// debug tools "screen'
//  view cache summary? (maybe useful, can view in Files, but not easily summarized)
//  test mode toggle
//  overlay present()able so we don't have to muck with main UI state
//    UI calls controller.debugUI(), controller does new await otherTable.present(), which temporarily overlays main UI
//    normal trigger (row/button/whatever) in main UI when in development mode
//    production mode
//      no trigger at all?
//      only hidden trigger? (invisible button in middle of blank row?)
// test mode in UI
//  main UI does not know about setting, but maybe summary editionsInfo includes a bool about it
//    development mode: always render as a part of summary
//    production mode: only render if test mode was active (nothing added if not in test mode)
//  controller tells UI about test mode via new flows
//    controller.getTestMode(this)...ui.testMode(true|false)  used during UI startup
//    controller.debugUI(this)...ui.testMode(true|false)      used to present debug UI
//    UI can render test mode status (e.g. as a banner in main UI, or just in GetISBNs rendering)
//  main UI does not know about setting, but controller pops alert if test mode xor production
//    alert offers Continue/Abort/Switch Modes
// real fetcher
// new input type: Scriptable bookmark
//  probably not useful for one-off users, but should be useful for frequent runs while developing
//  provide a one-tap way to use a previously selected bookmark
//    avoids the extra step of having to pick a bookmark (or go through DocumentPicker) to use a commonly used file
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
