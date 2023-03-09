// UITable-based UI uses controller to do the work

import production from 'consts:production';
import { assertNever, isObject } from './ts-utils.js';
import { Command, CommandSummary, GetISBNs, Input, MissingISBNs, UI, UIRequestReceiver } from './ui-types.js';
import { symbolCell, textCell, UITableBuilder } from './uitable-builder.js';

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

export class UITableUI implements UI {
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
    if (!isObject(this.previousCommands))
      this.previousCommands = {};
    /* eslint-enable */
    this.controller.requestEditionsServices(this);
  }
  private enabledEditionsServices: Set<string> = new Set;
  editionsServices(enabledServices: readonly string[]): void {
    this.enabledEditionsServices = new Set(enabledServices);
    this.saveState();
    this.state = this.validateState(this.state.input, false, this.state.command, this.state.progress, this.state.summary);
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

    if (command.name == 'GetISBNs') {
      command.editions = command.editions.filter(s => this.enabledEditionsServices.has(s));
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
      this.controller.debugUI(this);
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
      const editionsToggle = () => this.setCommand({ ...command, editions: editionsEnabled ? [] : Array.from(this.enabledEditionsServices) });
      const bothToggle = () => this.setCommand({ ...command, both: !command.both });
      const serviceToggle = (service: string) => {
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
        this.enabledEditionsServices.forEach(service => {
          const enabled = command.editions.includes(service);
          this.builder.addCheckableRow(service, enabled, { onSelect: () => serviceToggle(service) });
        });
      this.builder.addCheckableRow('Get Both ISBN-13 and -10?', command.both, { onSelect: bothToggle });
      const bothDesc = command.both
        ? 'The generated ISBNs will include both the ISBN-13 and ISBN-10 versions of each included ISBN.'
        : 'The generated ISBNs will be the ISBN-13 version of each included ISBN.';
      this.builder.addIndentRow(bothDesc, { height: 88 });

    } else assertNever(this.state.command);

    this.builder.addEmptyRow();

    if (this.state.ready) {
      const command = this.state.command;
      const shelfItems = this.state.input.info.shelfItems[command.shelf];
      this.builder.addForwardRow('Start', async () => {
        if (command.name == 'GetISBNs' && command.editions.length > 0) {

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
