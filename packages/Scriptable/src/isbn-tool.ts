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
  commandProgress(progress: { total: number, started: number, done: number, fetched: number }): void,
  commandCanceled(): void;
  commandSummary(summary: CommandSummary): void,

  getSavableData?(): unknown,
}

type RequestedInput = { type: 'clipboard' } | { type: 'file' };
type RequestedOutput = RequestedInput | { type: 'view' };
type MissingISBNs = { name: 'MissingISBNs', shelf: string };
type GetISBNs = { name: 'GetISBNs', shelf: string, both: boolean, editions: EditionsService[] };
type Command = MissingISBNs | GetISBNs;
interface UIRequestReceiver {
  debugUI(): void,
  requestInput(ui: UI, input: RequestedInput): void,
  requestCommand(ui: UI, command: Command): void,
  requestCancelCommand(ui: UI): void,
  requestOutput(ui: UI, output: RequestedOutput): void,
}

// helper that builds common patterns of UITable elements
type RowOpts = { onSelect?: () => void, dismissOnSelect?: boolean, height?: number, cellSpacing?: number };
function buildRow(opts?: RowOpts): UITableRow {
  const row = new UITableRow;
  if (opts?.onSelect) {
    row.onSelect = opts.onSelect;
    row.dismissOnSelect = false; // usual default is true
  }
  if (opts?.dismissOnSelect)
    row.dismissOnSelect = opts.dismissOnSelect;
  if (opts?.height)
    row.height = opts.height;
  if (opts?.cellSpacing)
    row.cellSpacing = opts.cellSpacing;
  return row;
}
type TextCell = { type: 'text', title: string, subtitle?: string, titleFont?: Font, titleColor?: Color /* font+color for subtitle */ };
type CellOpts = (
  | TextCell
  | { type: 'button', title: string, onTap: () => void }
  | { type: 'image', image: Image }
) & { align?: 'left' | 'center' | 'right', widthWeight?: number };
function textCell(text: string | TextCell, opts: Omit<TextCell, 'type' | 'title'> = {}): TextCell {
  return typeof text == 'string'
    ? { type: 'text', title: text, ...opts }
    : { ...text, ...opts };
}
function buildCell(opts: CellOpts): UITableCell {
  const cell = (() => {
    if (opts.type == 'text') {
      const cell = UITableCell.text(opts.title, opts.subtitle);
      if (opts.titleFont) cell.titleFont = opts.titleFont;
      if (opts.titleColor) cell.titleColor = opts.titleColor;
      return cell;
    } else if (opts.type == 'button') {
      const cell = UITableCell.button(opts.title);
      cell.onTap = opts.onTap;
      return cell;
    } else if (opts.type == 'image')
      return UITableCell.image(opts.image);
    else assertNever(opts);
  })();
  if (opts.align)
    cell[`${opts.align}Aligned`]();
  if (opts.widthWeight)
    cell.widthWeight = opts.widthWeight;
  return cell;
}
function symbolImageAndWidth(name: string): { image: Image; width: number; } {
  const image = SFSymbol.named(name).image;
  const sizes: Record<string, number | undefined> = {
    // out of 100 total widthWeight in a UITable presented full-screen in a UITableRow with cellSpacing:0 on a 414pt width screen (828@2x)
    'xmark': 9,
    'checkmark': 9,
    'checkmark.square': 9,
    'square': 9,
    'questionmark': 6,
    'questionmark.circle': 8,
    'questionmark.square': 9,
    'chevron.backward': 6,
    'chevron.forward': 6,
    'arrowtriangle.right.square.fill': 9,
    'arrowtriangle.down.square.fill': 9,
    'magnifyingglass': 9,
    'doc.on.clipboard': 8,
    'doc': 7,
  };
  return { image, width: sizes[name] ?? 10 };
}
function symbolCell(name: string): CellOpts & { widthWeight: number } {
  const { image, width: widthWeight } = symbolImageAndWidth(name);
  return { type: 'image', image, widthWeight };
}
class UITableBuilder {
  constructor(private table: UITable, private title: string) { }
  private addRow(opts?: RowOpts) {
    const row = buildRow(opts);
    this.table.addRow(row);
    return row;
  }
  addHeightAdjuster(row: UITableRow, updated: (newHeight: number) => void): UITableRow {
    const bump = (d: number) => () => { row.height += d; updated(row.height) };
    const m1 = buildCell({ type: 'button', title: '-1', align: 'left', onTap: bump(-1) });
    const m10 = buildCell({ type: 'button', title: '-10', align: 'left', onTap: bump(-10) });
    const show = buildCell({
      type: 'button', title: 'show/set', align: 'center', onTap: async () => {
        const a = new Alert;
        a.title = 'Current Height';
        a.message = `The curret ehight is ${row.height}.\n\nEnter a new height:`;
        const t = a.addTextField('new height', String(row.height));
        t.setNumberPadKeyboard();
        a.addCancelAction('Okay');
        await a.presentAlert();
        const h = parseInt(a.textFieldValue(0));
        if (h > 0) {
          row.height = h;
          updated(row.height);
        }
      }
    });
    const p10 = buildCell({ type: 'button', title: '+10', align: 'right', onTap: bump(10) });
    const p1 = buildCell({ type: 'button', title: '+1', align: 'right', onTap: bump(1) });
    return this.addRowWithCells([m1, m10, show, p10, p1]);
  }
  private addRowWithCells(cells: readonly UITableCell[], opts?: RowOpts) {
    const row = this.addRow(opts);
    cells.forEach(cell => row.addCell(cell));
    return row;
  }
  addTitleRow() {
    const cell = buildCell({ type: 'text', title: this.title, align: 'center', titleFont: Font.title1() });
    return this.addRowWithCells([cell]);
  }
  private addSymbolExamples() {
    const t = (n: string) => {
      // xmark                            9/100 17.5  49px 24.5pt
      // checkmark                        9/100 18.5
      // checkmark.square                 9/100 19.5
      // square                           9/100 19.5
      // questionmark                     6/100 13.5
      // questionmark.circle              8/100 20    50px 25pt
      // questionmark.square              9/100 19.5
      // chevron.backward                 6/100 12.5
      // chevron.forward                  6/100 12.5
      // arrowtriangle.right.square.fill  9/100 19.5
      // arrowtriangle.down.square.fill   9/100 19.5
      // magnifyingglass                  9/100 20.5
      // doc.on.clipboard                 8/100 21
      // doc                              7/100 18

      const { image, width } = symbolImageAndWidth(n);
      console.log(n);

      const imageWidth = image.size.width;
      console.log(image.size);
      console.log(imageWidth / (width / 100));
      console.log({ m: width, t: Math.trunc(imageWidth / 1.911), r: Math.round(imageWidth / 1.911) });
      const sw = Device.screenSize().width; // 414x896 2x 828x1792
      const dw = sw * width / 100;
      console.log(dw / imageWidth);

      const descs: CellOpts[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(w => ({ type: 'image', image, widthWeight: w }));
      const used = descs.reduce((a, d) => a + (d.widthWeight ?? 0), 0);
      this.addRowWithDescribedCells([...descs, { type: 'text', title: 'R', widthWeight: 100 - used }], { cellSpacing: 0 });
    };
    t('xmark');
    t('checkmark');
    t('checkmark.square');
    t('square');
    t('questionmark');
    t('questionmark.circle');
    t('questionmark.square');
    t('chevron.backward');
    t('chevron.forward');
    t('arrowtriangle.right.square.fill');
    t('arrowtriangle.down.square.fill');
    t('magnifyingglass');
    t('doc.on.clipboard');
    t('doc');
  }
  private addFontExamples() {
    ([
      'largeTitle',
      'title1',
      'title2',
      'title3',
      'headline',
      'subheadline',
      'body',
      'callout',
      'caption1',
      'caption2',
      'footnote',
    ] as const).forEach(fn => {
      this.addRowWithDescribedCells([{ type: 'text', title: fn, titleFont: Font[fn]() }]);
    });
  }
  addBackRow(text: string, onSelect: () => void) {
    const chevron = symbolCell('chevron.backward');
    const back = buildCell({ ...chevron, align: 'right' });
    const textCell = buildCell({ type: 'text', title: text, align: 'left', widthWeight: 100 - chevron.widthWeight });
    return this.addRowWithCells([back, textCell], { onSelect });
  }
  addSubtitleHelpRow(subtitle: string, helpLines?: string[]) {
    const qm = symbolCell('questionmark.circle');
    const cells = [];
    let helpFn;
    if (helpLines && helpLines.length > 0)
      helpFn = () => {
        const a = new Alert;
        a.title = this.title + '\n' + subtitle + '\n';
        a.message = helpLines.join('\n');
        a.addCancelAction('Okay');
        a.presentSheet();
      };
    if (helpFn)
      cells.push(buildCell({ type: 'text', title: '', widthWeight: qm.widthWeight }));
    cells.push(buildCell({ type: 'text', title: subtitle, align: 'center', titleFont: Font.title2(), widthWeight: 100 - 2 * qm.widthWeight }));
    if (helpFn)
      cells.push(buildCell({ ...qm, align: 'right' }));
    return this.addRowWithCells(cells, { onSelect: helpFn });
  }
  addEmptyRow() {
    return this.addRow();
  }
  addTextRow(text: string, opts: RowOpts = {}) {
    const cell = buildCell({ type: 'text', title: text });
    return this.addRowWithCells([cell], opts);
  }
  addIndentRow(text: string, opts: RowOpts = {}) {
    const indent = buildCell({ type: 'text', title: '', widthWeight: 1 });
    const main = buildCell({ type: 'text', title: text, widthWeight: 9 });
    return this.addRowWithCells([indent, main], opts);
  }
  addForwardRow(text: string | TextCell, onSelect: (() => void) | undefined) {
    const symbol = onSelect ? 'chevron.forward' : 'xmark';
    const image = symbolCell(symbol);
    const forward = buildCell({ ...image, align: 'left' });
    const txt = buildCell({ ...textCell(text), align: 'right', widthWeight: 100 - image.widthWeight });
    return this.addRowWithCells([txt, forward], { onSelect });
  }
  addClosedDisclosureRow(text: string, value: string, opts: RowOpts = {}) {
    const symbol = symbolCell('arrowtriangle.right.square.fill');
    const disclosure = buildCell({ ...symbol, align: 'left' });
    const textCell = buildCell({ type: 'text', title: text, align: 'left', widthWeight: 45 });
    const valueCell = buildCell({ type: 'text', title: value, align: 'right', widthWeight: 100 - 45 - symbol.widthWeight });
    return this.addRowWithCells([disclosure, textCell, valueCell], opts);
  }
  addOpenedDisclosureRow(text: string, opts: RowOpts = {}) {
    const symbol = symbolCell('arrowtriangle.down.square.fill');
    const disclosure = buildCell({ ...symbol, align: 'left' });
    const textCell = buildCell({ type: 'text', title: text, align: 'left', widthWeight: 100 - symbol.widthWeight });
    return this.addRowWithCells([disclosure, textCell], opts);
  }
  addCheckableRow(text: string, checked: boolean | undefined, opts: RowOpts = {}) {
    const mark = buildCell((() => {
      const check = symbolCell('checkmark.square');
      const uncheck = symbolCell('square');
      const widthWeight = Math.max(check.widthWeight, uncheck.widthWeight);
      if (typeof checked == 'undefined') return { type: 'text', title: '', widthWeight };
      const symbol = checked ? check : uncheck;
      return { ...symbol, align: 'left', widthWeight };
    })());
    const textCell = buildCell({ type: 'text', title: text, align: 'right', widthWeight: 100 - mark.widthWeight });
    return this.addRowWithCells([textCell, mark], opts);
  }
  addRowWithDescribedCells(cellDescs: readonly CellOpts[], opts: RowOpts = {}) {
    this.addRowWithCells(cellDescs.map(buildCell), opts);
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
type UICommandSummary = CommandSummary & { received: number };
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
    summary: UICommandSummary,
  }
  ;
type ByNames<T extends { name: PropertyKey }> = { [N in T['name']]: Extract<T, { name: N }> };

class UITableUI implements UI {
  private table: UITable = new UITable;
  private builder = new UITableBuilder(this.table, 'ISBN Export Tool');
  private presented = false;
  private state: UIState = {};
  constructor(private controller: UIRequestReceiver, private savedDataObject: Record<string, unknown>) {
    const restoredData = this.savedDataObject;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    // XXX validation typanion?
    this.previousCommand = restoredData.command as any;
    this.previousCommands = restoredData.commands as any;
    if (!isStore(this.previousCommands))
      this.previousCommands = {};
    /* eslint-enable */
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
  private validateState(input?: Input, restorePrevious = false, command?: PartialCommand, progress?: Progress, summary?: UICommandSummary): UIState {

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

    this.buildDebug();

    const title = this.builder.addTitleRow();
    title.isHeader = true;

    if (this.state.summary)
      this.buildSummary();
    else if (this.state.progress)
      this.buildProgress();
    else if (this.state.command)
      this.buildCommand();
    else if (this.state.input)
      this.buildPickCommand();
    else
      this.buildPickInput();

    if (this.presented) this.table.reload();
  }
  private buildDebug(): void {
    const empty = new UITableRow;
    empty.addText('').widthWeight = 4;
    const button = empty.addButton(production ? ' ' : 'DEBUG');
    button.centerAligned();
    button.onTap = () => {
      controller.debugUI();
    };
    button.widthWeight = 2;
    empty.addText('').widthWeight = 4;
    this.table.addRow(empty);
  }
  private buildPickInput(): void {
    this.builder.addSubtitleHelpRow('Input Selection', [
      'This program reads exported book list data to let you access the ISBNs of your books in various ways:',
      'Check exported listings for missing ISBNs, and',
      'Extract ISBNs from exported data (optionally including ISBNS of other editions of the listed book).',
      '',
      'Currently, Goodreads export format (CSV with a specific set of columns) and its "shelf" system are supported.',
      'Suggest your favorite book list format for support in future versions!',
      '',
      'Goodreads Export Tips',
      'Exporting your Goodreads can be done from the Goodreads website:',
      'Login,',
      'If on a mobile device, tap/click the "Desktop version" link in the footer of the website,',
      'Tap/click on the "My Books" tab,',
      'In the left sidebar, find the "Tools" section and tap/click on "Import and Export" link',
      'On the Import/Export page tap/click "Export Library" button at the top of the page.',
      'A link like "Your export from <date>" will appear when the export is ready.',
      '',
      'Once the export is ready, you can download the file (it will be in the Files app in your Downloads folder), or view the data and use Select All and Copy to copy it to the clipboard.',
      '',
      'When you have your data ready, you can tell this program where to find it using the selections on this Input screen.'
    ]);
    this.builder.addEmptyRow();
    this.builder.addTextRow('Where is your export data?');
    this.builder.addEmptyRow();
    if (this.previousInput) {
      const prev = this.previousInput;
      this.builder.addForwardRow(textCell('already loaded', { titleColor: Color.orange() }), () => this.setInput(prev));
    }
    this.builder.addForwardRow('On the clipboard', () => this.controller.requestInput(this, { type: 'clipboard' }));
    this.builder.addForwardRow('In a saved or downloaded file', () => this.controller.requestInput(this, { type: 'file' }));
  }
  private setCommand(command?: PartialCommand, restorePrevious = false) {
    this.saveState();
    this.state = this.validateState(this.state.input, restorePrevious, command);
    this.build();
  }
  private buildPickCommand() {
    if (!this.state.input) throw 'tried to build command picker UI without input';
    this.builder.addBackRow('Input Selection', () => this.setInput(void 0));
    this.builder.addSubtitleHelpRow('Command Selection', [
      'Two commands area available to process your Goodreads export data:',
      '',
      'Missing ISBNs',
      'This command will tell you which items on a shelf are missing ISBNs.',
      '',
      'Get ISBNs',
      'This command will extract the ISBN of every ISBN-bearing item on a shelf.',
      '',
      'Select a command and view its help for more details.',
    ]);
    this.builder.addEmptyRow();
    this.builder.addTextRow(`Found ${this.state.input.info.items} items in export data.`);
    this.builder.addEmptyRow();
    this.builder.addTextRow('Which command would you like to run?');
    this.builder.addEmptyRow();
    this.builder.addForwardRow('Missing ISBNs', () => this.setCommand({ name: 'MissingISBNs' }, true));
    this.builder.addIndentRow('Finds items on a specified shelf that have no ISBN.', { height: 88 });
    this.builder.addForwardRow('Get ISBNs', () => this.setCommand({ name: 'GetISBNs', both: false, editions: [] }, true));
    this.builder.addIndentRow('Extracts ISBNs from items on a specified shelf.', { height: 88 });
  }
  private buildCommand() {
    if (!this.state.command) throw 'tried to build command UI without command';
    this.builder.addBackRow('Command Selection', () => this.setCommand(void 0, false));
    if (this.state.command.name == 'MissingISBNs') {

      this.builder.addSubtitleHelpRow('Missing ISBNs', [
        'Sometimes when shelving a new book, Goodreads will pick a default edition '
        + '(perhaps an eBook or audiobook edition) that happens to lack an ISBN. '
        + 'This is usually okay if you mostly review shelved items "by eye", or by title/author search, '
        + 'but the companion "Get ISBNs" command in this program cannot process an item if it lacks an ISBN.',
        '',
        'You can change the edition of a shelved item from its Book Details page '
        + '(where you will see an ISBN listed, if the item has one), in the Editions list, '
        + 'by using the "Switch to this edition" button under a different version (most print versions will have an ISBN).',
        '',
        'Note: If you switched any editions, you will probably want to re-export your Goodreads data before using "Get ISBNs".',
      ]);
      this.builder.addEmptyRow();
      this.builder.addTextRow(`Found ${this.state.input.info.items} items in export data.`);
      this.builder.addTextRow('Choose the shelf to check for items with no ISBN.', { height: 88 });
      this.builder.addIndentRow('Ex: You might check your "to-read" shelf before using "Get ISBNs" on it.', { height: 88 });
      this.buildSharedShelf();

    } else if (this.state.command.name == 'GetISBNs') {

      this.builder.addSubtitleHelpRow('Get ISBNs', [
        'Some libraries let you import a list of ISBNs to check what is available in their collection.',
        'You can use "Get ISBNs" on your "to-read" shelf and import the resulting ISBN list into a library '
        + 'to find what is available to read at that library.',
        '',
        'Since there are often multiple editions of every book, this command can optionally query external services '
        + '(Open Library, and Library Thing) to gather the ISBNs of other editions of your shelved items '
        + '(so, for example, the ISBN list will include the hardcover and paperback editions, no matter which edition you '
        + 'have shelved——assuming the services know about the edition: they are not always 100% complete).',
        '',
        'ISBNs come in two versions: ISBN-13, and ISBN-10 (old style). Every ISBN has an ISBN-13 version, '
        + 'but might not have an ISBN-10 version. '
        + 'If you are taking your list of ISBNs somewhere that does not automatically convert between the ISBN versions, '
        + 'this command can optionally include both ISBN versions (when possible).'
      ]);
      this.builder.addEmptyRow();
      this.builder.addTextRow(`Found ${this.state.input.info.items} items in export data.`);
      this.builder.addTextRow('Choose the shelf from which ISBNs will be extracted.', { height: 88 });
      this.builder.addIndentRow('Ex: Get the ISBNs from your "to-read" shelf and send it to your library to see which items they have available.', { height: 132 });
      this.buildSharedShelf();

      const command = this.state.command;
      const editionsEnabled = command.editions.length != 0;
      const editionsToggle = () => this.setCommand({ ...command, editions: editionsEnabled ? [] : Array.from(AllEditionsServices) });
      const bothToggle = () => this.setCommand({ ...command, both: !command.both });
      const serviceToggle = (service: EditionsService) => {
        let editions;
        if (command.editions.includes(service))
          editions = command.editions.filter(s => s != service);
        else
          editions = command.editions.concat([service]);
        this.setCommand({ ...command, editions });
      };

      this.builder.addTextRow('Options');
      this.builder.addCheckableRow('Get ISBNs of Other Editions?', editionsEnabled && void 0, { onSelect: editionsToggle });
      const editionsDesc = editionsEnabled
        ? 'External services (as selected below) will be queried for the ISBNs of other editions of each imported ISBN.'
        : 'The ISBNs will only come from the imported data.';
      this.builder.addIndentRow(editionsDesc, { height: 88 });
      if (editionsEnabled)
        AllEditionsServices.forEach(service => {
          const enabled = command.editions.includes(service);
          this.builder.addCheckableRow(service, enabled, { onSelect: () => serviceToggle(service as EditionsService) });
        });
      this.builder.addCheckableRow('Get Both ISBN-13 and -10?', command.both, { onSelect: bothToggle });
      const bothDesc = command.both
        ? 'The generated ISBNs will include both the ISBN-13 and ISBN-10 versions of each included ISBN.'
        : editionsEnabled
          ? 'The generated ISBNs will be the ISBN-13 version of each included ISBN.'
          : 'The generated ISBNs will come directly from the imported data: ISBN-13 if present, otherwise ISBN-10.';
      this.builder.addIndentRow(bothDesc, { height: 88 });

    } else assertNever(this.state.command);

    this.builder.addEmptyRow();

    if (this.state.ready) {
      const command = this.state.command;
      const shelfItems = this.state.input.info.shelfItems[command.shelf];
      this.builder.addForwardRow('Start', async () => {
        if (command.name == 'GetISBNs' && command.editions.length > 0) {

          const a = new Alert;
          a.title = '"Other Editions" Takes Time';
          a.message = 'Due to having to use external services, we limit how quickly we issue queries for other edition ISBNs. '
            + 'It will take a second or two per queried ISBN to complete this command.\n'
            + '\n'
            + `This may be between ${shelfItems} and ${shelfItems * 2} seconds for the items on the "${command.shelf}" shelf.\n`
            + '\n'
            + 'The query results are saved for later re-use, so subsequent runs will be faster (assuming some recurring ISBNs).';
          a.addCancelAction('That is too long to wait!');
          a.addAction('That is okay, I will wait.');
          const action = await a.presentAlert();
          if (action == -1) return;
        }
        this.controller.requestCommand(this, command);
      });
    } else {
      this.builder.addForwardRow('Start', void 0);
      this.builder.addIndentRow('A shelf must be selected before the command can be started.', { height: 88 });
    }
  }
  private buildSharedShelf(): void {
    if (!this.state.command) throw 'tried to build shelf UI without a command';
    if (this.state.command.shelf) {

      const noShelf = { ...this.state.command, shelf: void 0 };
      this.builder.addClosedDisclosureRow('Shelf', this.state.command.shelf, { onSelect: () => this.setCommand(noShelf) });

    } else {

      const previousShelf = this.previousCommands[this.state.command.name]?.shelf;
      const withPreviousShelf = { ...this.state.command, shelf: previousShelf };
      const canRevert = typeof withPreviousShelf.shelf != 'undefined' || void 0;
      this.builder.addOpenedDisclosureRow('Shelf', canRevert && { onSelect: () => this.setCommand(withPreviousShelf) });
      const shelfItems = this.state.input.info.shelfItems;
      const addShelfRow = (shelf: string, items: string, onSelect?: () => void, previous = false) =>
        this.builder.addRowWithDescribedCells([
          { type: 'text', title: shelf, widthWeight: 85, align: 'right', titleColor: (previous || void 0) && Color.orange() },
          { type: 'text', title: items, widthWeight: 15, align: 'left' },
        ], { onSelect, cellSpacing: 10 });
      addShelfRow('Shelf Name', 'Items');
      Object.getOwnPropertyNames(shelfItems)
        .forEach(shelf => addShelfRow(shelf, String(shelfItems[shelf]),
          () => this.setCommand({ ...withPreviousShelf, shelf }), shelf == previousShelf));

    }
  }
  private buildProgress() {
    if (!this.state.progress) throw 'tried to build progress UI without progress';
    if (this.state.summary) throw 'tried to build progress UI after command completed';

    this.builder.addBackRow('Cancel Get ISBNs', async () => {
      const a = new Alert;
      a.title = 'Cancel Get ISBNs?';
      a.message = 'Normal operation will take a second or two per query to finish.';
      a.addAction('Yes: Stop making queries!');
      a.addCancelAction('No: I will wait.');
      const action = await a.presentAlert();
      console.log(`progress cancel warning result: ${action}`);
      if (action == -1) return;
      this.controller.requestCancelCommand(this);
    });
    this.builder.addSubtitleHelpRow('Get ISBNs "Other Editions" Progress');
    this.builder.addEmptyRow();
    this.builder.addTextRow(`Retrieving ISBNs of other editions of ISBN-bearing items on "${this.state.command.shelf}" shelf.`, { height: 88 });

    const { total, started, done, fetched } = this.state.progress;
    const waiting = total - started;
    const active = started - done;
    this.builder.addTextRow(`Queries:`);
    this.builder.addIndentRow(`${done} done + ${active} active + ${waiting} waiting = ${total}`);
    this.builder.addTextRow(`Fetches:`);
    this.builder.addIndentRow(`${fetched}`);
  }
  private setProgress(progress: Progress) {
    this.saveState();
    this.state = this.validateState(this.state.input, false, this.state.command, progress);
    this.build();
  }
  commandProgress(progress: { total: number, started: number, done: number, fetched: number }): void {
    this.setProgress(progress);
  }
  commandCanceled(): void {
    this.setCommand(this.state.command, true);
  }
  commandSummary(summary: CommandSummary) {
    this.setSummary({ ...summary, received: Date.now() });
  }
  private setSummary(summary: UICommandSummary) {
    this.saveState();
    this.state = this.validateState(this.state.input, false, this.state.command, this.state.progress ?? { total: 0, started: 0, done: 0, fetched: 0 }, summary);
    this.build();
  }
  private buildSummary() {
    if (!this.state.summary) throw 'tried to build summary UI without summary';

    const command = this.state.command;
    const commandName =
      command.name == 'MissingISBNs' ? 'Missing ISBNs' :
        command.name == 'GetISBNs' ? 'Get ISBNs' :
          assertNever(command);
    const summary = this.state.summary;
    const confirmBack: () => Promise<boolean> = async () => {
      if (command.name != 'GetISBNs') return true;
      if (command.editions.length <= 0) return true;
      const newish = Date.now() - summary.received < 5000;
      if (!newish) return true;
      const a = new Alert;
      a.title = `Leaving So Soon?`;
      a.message = `${commandName} just finished a few seconds ago.\n\nPlease confirm that you want to abandon these results and go back.`;
      a.addAction('Abandon these results and go back now.');
      a.addCancelAction('Do not go back yet.');
      return await a.presentAlert() != -1;
    };
    this.builder.addBackRow(`${commandName} Options`, async () => await confirmBack() && this.setCommand(command));
    this.builder.addSubtitleHelpRow(`${commandName} Summary`, [
      'The command results are summarized here. Select an output option to view or save the full output.',
      '',
      'The "back" options at the bottom jump back to various screens (also available through multiple taps on "back" at the top).',
    ]);
    this.builder.addEmptyRow();


    if (summary.name == 'MissingISBNs') {
      if (command.name != summary.name) throw 'got summary for different command'; // let TS know that command is also GetISBNs

      const shelf = this.state.command.shelf;
      const items = this.state.input.info.shelfItems[shelf] ?? -1;
      this.builder.addTextRow(`${summary.itemsMissingISBN} items with no ISBN (out of ${items} on "${shelf}" shelf).`, { height: 88 });
      if (summary.itemsMissingISBN > 0)
        this.builder.addIndentRow('Note: If you adjust your shelved editions, you should re-export your data before using "Get ISBNs".', { height: 88 });

    } else if (summary.name == 'GetISBNs') {
      if (command.name != summary.name) throw 'got summary for different command'; // let TS know that command is also GetISBNs

      const optionsDescription = (editions: boolean, both: boolean) => {
        const editionsText = 'retrieving ISBNs of other editions';
        const bothText = 'adding ISBN-10 equivalents';
        if (!editions && !both)
          return '';
        else if (!editions && both)
          return ` after ${bothText}`;
        else if (editions && !both)
          return ` after ${editionsText}`;
        else if (editions && both)
          return ` after ${editionsText}, and ${bothText}`;
      };
      const shelf = this.state.command.shelf;
      const items = this.state.input.info.shelfItems[shelf] ?? -1;
      this.builder.addTextRow(`From ${items} "${shelf}" items,`);
      this.builder.addTextRow(`${summary.totalISBNs} total ISBNs extracted${optionsDescription(command.editions.length > 0, command.both)}.`, { height: 88 });

      if (summary.editionsInfo) {
        const cached = Object.entries(summary.editionsInfo).reduce((t, [, i]) => t + i.cacheHits, 0);
        if (cached != 0)
          this.builder.addTextRow(`Reused ${cached} Other Editions query results.`, { height: 88 });

        Object.entries(summary.editionsInfo).forEach(([service, info]) => {
          this.builder.addTextRow(`${service}`);
          this.builder.addIndentRow((info.cacheHits != 0 ? `${info.cacheHits} reused results, ` : '') + `${info.queries} new queries`);
          if (info.fetches != 0) {
            this.builder.addIndentRow(`${info.fetches} fetches ${info.fetchRate.toFixed(3)}/s`);
            this.builder.addIndentRow(`${info.fetchStats.min}/${info.fetchStats.median}/${info.fetchStats.max} (ms min/median/max)`);
          }
        });
      }

    } else assertNever(summary);

    this.builder.addEmptyRow();
    this.builder.addTextRow('Output Options');
    const view = symbolCell('magnifyingglass');
    const clip = symbolCell('doc.on.clipboard');
    const file = symbolCell('doc');
    const max = Math.max(...[view, clip, file].map(s => s.widthWeight));
    [view, clip, file].forEach(s => s.widthWeight = max);
    const addOutputRow = (title: string, symbol: typeof view, onSelect: () => void) => {
      const widthWeight = 100 - symbol.widthWeight;
      this.builder.addRowWithDescribedCells([{ type: 'text', title, align: 'right', widthWeight }, { ...symbol, align: 'center' }], { onSelect });
    };
    addOutputRow('View', view, () => this.controller.requestOutput(this, { type: 'view' }));
    addOutputRow('Copy to the clipboard', clip, () => this.controller.requestOutput(this, { type: 'clipboard' }));
    addOutputRow('Save to a file', file, () => this.controller.requestOutput(this, { type: 'file' }));
    this.builder.addEmptyRow();
    this.builder.addBackRow(`Choose New ${commandName} Options`, async () => await confirmBack() && this.setCommand(command));
    this.builder.addBackRow('Choose New Command', async () => await confirmBack() && this.setCommand(void 0));
    this.builder.addBackRow('Choose New Input', async () => await confirmBack() && this.setInput(void 0));
  }
  async present(...args: Parameters<UITable['present']>): ReturnType<UITable['present']> {
    this.presented = true;
    try {
      return await this.table.present(...args);
    } finally {
      this.presented = false;
      this.saveState();
      this.savedDataObject.commands = this.previousCommands;
      this.savedDataObject.command = this.previousCommand;
    }
  }
}

// controller interfaces with tool-core on behalf of a non-specific UI

import { type Fetcher, type FetchResult, getISBNs, missingISBNs, type Row, shelfInfo } from 'utils';
import { toCSV } from 'utils';
import { pick } from 'utils';
import production from 'consts:production';

type CommandOutput =
  | { name: 'MissingISBNs', shelf: string, rows: Row[] }
  | { name: 'GetISBNs', shelf: string, isbns: Set<string> }
  ;

class Controller implements UIRequestReceiver {
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
        const fm = FileManager.local();
        const csv = fm.readString(pathname);
        return { csv, input: { type, displayName: fm.fileName(pathname), info: await getInputInfo(csv) } };

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
    if (type == 'view')

      QuickLook.present(out, true);

    else if (type == 'clipboard') {

      Pasteboard.copyString(out);
      infoAlert('Copied!', 'The output has been copied to the clipboard.');

    } else if (type == 'file') {

      const pickedPaths = await DocumentPicker.exportString(out, filename); // cancel rejects
      const fm = FileManager.local();
      const basename = (pn: string) => fm.fileName(pn);
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
if (!store.data.UITableUIData) store.data.UITableUIData = {};
if (!isStore(store.data.UITableUIData)) throw 'restored UI data is not an object?';

const logPathname = asidePathname(module.filename, 'log');
const testLogPathname = asidePathname(module.filename, 'log', bn => bn + ' test');
const cachePathname = asidePathname(module.filename, 'json', bn => bn + ' cache');
const testCachePathname = asidePathname(module.filename, 'json', bn => bn + ' test cache');

const controller = new Controller(
  testMode => testMode ? testLogPathname : logPathname,
  testMode => testMode ? testCachePathname : cachePathname,
);

const ui = new UITableUI(controller, store.data.UITableUIData);
await ui.present(true);
await controller.abortIfRunning();

await store.write();

// (known) BUGS
// log rejections?

// TODO
// test mode
//  report test mode in progress and summary?
// GetISBNs Summary
//  editions details too noisy?
//    maybe put them in a disclosure, or in an alert, or below "save" + "back" actions?
// AllEditionsServices (part of utils) is now coupled to UI, move it to controller or main and have it passed in?

// STYLING
// styling? default in dark mode is white on black, buttons are blue on black header is bold
//  something special for "need to pick something here"?

// FUTURE
// break shelves into exclusive & other?
//  then, let the UI do the sorting?
// UI to pre-filter shelf contents before sending to GetISBNs editions?
//  might get complicated to deal with long lists
//    need to be able to sort on author or title, search too?
//  maybe not GetISBNs-specific could be generic to either if the core functions re-worked to take Row[] instead of CSV+shelf
// debug tools "screen'
//  view cache summary? (maybe useful, can view in Files, but not easily summarized)
//    needs helper from cache code since we don't want to have to pick apart the possibly changing saved cache representation
//    cachedQueryCount: Map<EditionsService,number>
//    anything about expirations?
//    "histogram" of # of queried ISBNs with N editions
//      maybe need to be able to see source ISBN, too: if looking to try to reduce output size by eliminating/skipping "many editions" works
// bar graph for progress?
// output
//  missing: let user pick columns?
// new input type: Scriptable bookmark
//  probably not useful for one-off users, but should be useful for frequent runs while developing
//  provide a one-tap way to use a previously selected bookmark
//    avoids the extra step of having to pick a bookmark (or go through DocumentPicker) to use a commonly used file
// collapse input UI after selection, before input() comes back
//  so UI responds right away, to avoid extra tapping if the response is delayed
//  make UI non-interactive and provide progress?
// updateExceptUndefined
//  helper for saveState updating previousCommands to not overwrite a non-undefined shelf with undefined
