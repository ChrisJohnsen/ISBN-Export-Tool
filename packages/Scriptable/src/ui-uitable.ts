// UITable-based UI uses controller to do the work

import { outdent as outdentDefault } from 'outdent';
const outdent = outdentDefault({ newline: '\n' });
import production from 'consts:production';
import { assertNever } from './ts-utils.js';
import { type EditionsSummary, type Summary, type Input, type UIRequestReceiver, type EditionsProgress, type RequestedOutput } from './ui-types.js';
import { symbolCell, textCell, UITableBuilder } from './uitable-builder.js';

type UISummary = Summary & { choosingOutput?: 'missing' | 'ISBNs' & { both: boolean } };
type UIEditionsSummary = EditionsSummary & { received: number, both: boolean };
type UIState =
  | {
    input?: undefined,
    shelf?: undefined,
    summary?: undefined,
    editionsServices?: undefined,
    editionsProgress?: undefined,
    editionsSummary?: undefined,
  }
  | {
    input: Input,
    shelf?: undefined,
    summary?: undefined,
    editionsServices?: undefined,
    editionsProgress?: undefined,
    editionsSummary?: undefined,
  }
  | {
    input: Input,
    shelf: string,
    summary?: undefined,
    editionsServices?: undefined,
    editionsProgress?: undefined,
    editionsSummary?: undefined,
  }
  | {
    input: Input,
    shelf: string,
    summary: UISummary,
    editionsServices?: undefined,
    editionsProgress?: undefined,
    editionsSummary?: undefined,
  }
  | {
    input: Input,
    shelf: string,
    summary: UISummary,
    editionsServices: Set<string>,
    editionsProgress?: undefined,
    editionsSummary?: undefined,
  }
  | {
    input: Input,
    shelf: string,
    summary: UISummary,
    editionsServices: Set<string>,
    editionsProgress: EditionsProgress,
    editionsSummary?: undefined,
  }
  | {
    input: Input,
    shelf: string,
    summary: UISummary,
    editionsServices: Set<string>,
    editionsProgress: EditionsProgress,
    editionsSummary: UIEditionsSummary,
  }
  ;

export class UITableUI {
  private table: UITable = new UITable;
  private builder = new UITableBuilder(this.table, 'ISBN Export Tool');
  private presented = false;

  private previousShelf?: string;
  private previousServices?: string[];
  private previousBoth?: boolean;
  constructor(private controller: UIRequestReceiver, private savedDataObject: Record<string, unknown>) {
    const restoredData = this.savedDataObject;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    // XXX validation typanion?
    this.previousShelf = restoredData.shelf as any;
    this.previousServices = restoredData.services as any;
    if (!Array.isArray(this.previousServices))
      this.previousServices = void 0;
    this.previousBoth = restoredData.both as any;
    /* eslint-enable */
    if (typeof this.previousBoth != 'boo' + 'lean')
      this.previousBoth = void 0;
    this.build();
  }
  private saveData() {
    this.savePrevious();
    this.savedDataObject.shelf = this.previousShelf;
    this.savedDataObject.services = this.previousServices;
    this.savedDataObject.both = this.previousBoth;
  }
  private state: UIState = {};
  private input(input?: Input) {
    this.savePrevious();
    this.state = this.validateState(input, true);
    this.build();
  }
  private previousInput?: Input;
  private savePrevious() {

    if (!this.state.input) return;

    this.previousInput = this.state.input;

    if (!this.state.shelf) return;

    this.previousShelf = this.state.shelf;

    if (this.state.summary) {
      const output = this.state.summary.choosingOutput;
      if (output == 'ISBNs')
        this.previousBoth = output.both;
    }
    if (this.state.editionsSummary) {
      this.previousBoth = this.state.editionsSummary.both;
    }

    if (!this.state.editionsServices
      || this.state.editionsServices.size <= 0) return;

    this.previousServices = Array.from(this.state.editionsServices);
  }
  private validateState(input?: Input, restorePrevious = false, shelf?: string, summary?: UISummary, editionsServices?: Set<string>, editionsProgress?: EditionsProgress, editionsSummary?: UIEditionsSummary): UIState {

    const validatedShelf = (input: Input, shelf?: string) => {
      if (typeof shelf == 'undefined')
        return void 0;
      if (Object.hasOwn(input.shelfItems, shelf))
        return shelf;
    };

    if (!input) return {};

    shelf = validatedShelf(input, shelf);

    if (restorePrevious)
      shelf ??= validatedShelf(input, this.previousShelf);

    if (!shelf) return { input };
    if (!summary) return { input, shelf };

    if (restorePrevious) {
      if (this.previousServices)
        editionsServices ??= new Set(this.previousServices);
    }

    if (!editionsServices) return { input, shelf, summary };
    if (!editionsProgress) return { input, shelf, summary, editionsServices };
    if (!editionsSummary) return { input, shelf, summary, editionsServices, editionsProgress };
    return { input, shelf, summary, editionsServices, editionsProgress, editionsSummary };

  }
  private async build() {
    this.table.removeAllRows();
    this.table.showSeparators = true;

    this.buildDebug();

    const title = this.builder.addTitleRow();
    title.isHeader = true;

    if (this.state.editionsSummary)
      this.buildEditionsSummary();
    else if (this.state.editionsProgress)
      this.buildEditionsProgress();
    else if (this.state.editionsServices)
      await this.buildPickEditionsServices();
    else if (this.state.summary)
      this.buildSummary();
    else if (this.state.input)
      this.buildPickShelf();
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
      this.controller.debugUI().then(() => this.build());
    };
    button.widthWeight = 2;
    empty.addText('').widthWeight = 4;
    this.table.addRow(empty);
  }
  private buildPickInput(): void {
    this.builder.addSubtitleHelpRow('Input Selection', outdent`
      This program reads exported book list data to let you access the ISBNs of your listed items.

      You can review the items that are missing ISBNs, and view or save the list of ISBNs (optionally including ISBNs of other editions of the listed book).

      Some libraries can import such an ISBN list and use it to show which of those books they have available in their holdings (e.g. which of your "To Be Read" list is available for checkout).

      Currently, Goodreads export format (CSV with a specific set of columns) and its "shelf" system are supported.
      Suggest your favorite book list format for support in future versions!

      When you have your data ready, tell this program where to find it using the selections on this Input Selection screen.
    `, {
      'Goodreads Export': outdent`
      Exporting your Goodreads can be done from the Goodreads website:


      Login,

      If on a mobile device, tap/click the "Desktop version" link in the footer of the website,

      Tap/click on the "My Books" tab,

      In the left sidebar, find the "Tools" section and tap/click on "Import and Export" link

      On the Import/Export page tap/click "Export Library" button at the top of the page.

      A link like "Your export from <date>" will appear when the export is ready.


      Once the export is ready, you can download the file (it will be in the Files app in your Downloads folder), or view the data in your web browser and use Select All and Copy to copy it to the clipboard.
    `});
    this.builder.addEmptyRow();
    this.builder.addTextRow('Where is your export data?');
    this.builder.addEmptyRow();
    if (this.previousInput) {
      const prev = this.previousInput;
      this.builder.addForwardRow(textCell('already loaded', { titleColor: Color.orange() }), () => this.input(prev));
    }
    this.builder.addForwardRow('On the clipboard', () => this.controller.requestInput({ type: 'clipboard' }).then(i => this.input(i)));
    this.builder.addForwardRow('In a saved or downloaded file', () => this.controller.requestInput({ type: 'file' }).then(i => this.input(i)));
  }
  private buildPickShelf(): void {
    if (!this.state.input) throw 'tried to build shelf picker UI without input';

    this.builder.addBackRow('Input Selection', () => this.input());
    this.builder.addSubtitleHelpRow('Item Selection', outdent`
      Start by selecting which items from the exported data we will examine. The next step will check the selection for items that are missing ISBNs.

      Currently only a whole "shelf" of items can be selected. On this screen, choose the shelf that holds the items you want to examine.
    `);
    this.builder.addEmptyRow();
    this.builder.addTextRow(`Found ${this.state.input.items} items in export data.`);
    this.builder.addTextRow('Choose the shelf to examine.');

    const shelfItems = this.state.input.shelfItems;
    const addShelfRow = (shelf: string, items: string, onSelect?: () => void, previous = false) =>
      this.builder.addRowWithDescribedCells([
        { type: 'text', title: shelf, widthWeight: 85, align: 'right', titleColor: previous ? Color.orange() : void 0 },
        { type: 'text', title: items, widthWeight: 15, align: 'left' },
      ], { onSelect, cellSpacing: 10 });
    addShelfRow('Shelf Name', 'Items');
    Object.getOwnPropertyNames(shelfItems)
      .forEach(shelf => addShelfRow(shelf, String(shelfItems[shelf]),
        () => this.setShelf(shelf), shelf == this.previousShelf));
  }
  private setShelf(shelf: string) {
    this.savePrevious();
    this.state = this.validateState(this.state.input, false, shelf);
    if (this.state.shelf)
      this.controller.requestShelf(this.state.shelf).then(s => this.summary(s));
  }
  private summary(summary?: UISummary) {
    this.savePrevious();
    this.state = this.validateState(this.state.input, false, this.state.shelf, summary);
    this.build();
  }
  private buildSummary(): void {
    if (!this.state.summary) throw 'tried to build item summary UI without summary';

    const shelf = this.state.shelf;
    const items = this.state.input.shelfItems[shelf] ?? 0;
    const summary = this.state.summary;
    const addMissingSummaryRow = () =>
      this.builder.addTextRow(`${summary.missingISBNCount} items with no ISBN.`);
    const addISBNSummaryRow = () =>
      this.builder.addTextRow(`${summary.isbnCount} items with an ISBN.`);
    const ISBNs = (both: boolean) => Object.assign('ISBNs', { both });
    if (!summary.choosingOutput) {
      this.builder.addBackRow('Item Selection', () => this.summary());
      this.builder.addSubtitleHelpRow('Item Summary', outdent`
        The bulk of this program works only with ISBNs, so any item that lacks an ISBN can not be usefully processed beyond pointing out the missing ISBN.

        Items missing an ISBN often occur because the default edition is an eBook or audiobook version that happens to not use an ISBN. If you did not mean to secifically select that non-ISBN edition you can usually change the listing (e.g. Goodread's Book Details) to an ISBN-bearing edition so that its ISBN can be used by the rest of this program in a future data export.

        Every item from the provided data that does not have an ISBN is in the "Items Missing an ISBN" list. Likewise, every item that has an ISBN will contribute it to the "Item ISBNs" list.

        Each category can be viewed or saved by selecting its view/save option.

        You can use the "Select Editions Services" option to extend the list of ISBNs with those of other editions of the same work. See the help on that screen for more information.
      `);
      this.builder.addEmptyRow();
      this.builder.addTextRow(`${items} items in selection ("${shelf}" shelf).`);
      addMissingSummaryRow();
      this.builder.addForwardRow('View/Save Items Missing an ISBN', () => this.summary({ ...summary, choosingOutput: 'missing' }));
      addISBNSummaryRow();
      this.builder.addForwardRow('View/Save Item ISBNs', () => this.summary({ ...summary, choosingOutput: ISBNs(this.previousBoth ?? false) }));
      this.builder.addEmptyRow();
      this.builder.addTextRow('Want to also include the ISBNs of other editions of the extracted item ISBNs?', { height: 88 });
      this.builder.addForwardRow('Select Editions Services', () => this.setEditionsServices(void 0, true));
    } else {
      const choice = (outputChoice => {
        if (outputChoice == 'missing') {
          return {
            desc: 'Items Missing an ISBN',
            output: (kind: RequestedOutput) => this.controller.requestOutputMissing(kind).then(() => this.outputDone()),
            addSummaryRow: addMissingSummaryRow,
          };
        } else if (outputChoice == 'ISBNs') {
          const both = outputChoice.both;
          const toggleBoth = () => this.summary({ ...summary, choosingOutput: ISBNs(!both) });
          return {
            desc: 'Item ISBNs',
            output: (kind: RequestedOutput) => this.controller.requestOutputISBNs(both, kind).then(() => this.outputDone()),
            addSummaryRow: addISBNSummaryRow,
            extraOutput: () => this.builder.addCheckableRow('Include both ISBN-10 and ISBN-13?', both, { onSelect: toggleBoth }),
            extraHelp: outdent`


              Only the ISBN-13 version of each ISBN are provided by default. Select the "Include both" option to also include the ISBN-10 version when possible (not all ISBNs have an old-style ISBN-10 version).
            `,
          };
        } else assertNever(outputChoice);
      })(summary.choosingOutput);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { choosingOutput, ...backSummary } = summary;
      this.builder.addBackRow('Item Summary', () => this.summary(backSummary));
      console.log(`<<${choice.extraHelp}>>`);
      this.builder.addSubtitleHelpRow(`${choice.desc}`,
        'Select an Output Option to view or save the full output.' + (choice.extraHelp ?? ''),
      );
      this.builder.addEmptyRow();

      this.builder.addTextRow(`${items} items in selection ("${shelf}" shelf).`);
      choice.addSummaryRow();

      this.buildSharedOutput(choice.output, choice.extraOutput);
    }
  }
  private buildSharedOutput(output: (kind: RequestedOutput) => void, buildExtraOptionRows?: () => void) {
    this.builder.addTextRow('Output Options');
    buildExtraOptionRows?.();
    const view = symbolCell('magnifyingglass');
    const clip = symbolCell('doc.on.clipboard');
    const file = symbolCell('doc');
    const max = Math.max(...[view, clip, file].map(s => s.widthWeight));
    [view, clip, file].forEach(s => s.widthWeight = max);
    const addOutputRow = (title: string, symbol: typeof view, onSelect: () => void) => {
      const widthWeight = 100 - symbol.widthWeight;
      this.builder.addRowWithDescribedCells([{ type: 'text', title, align: 'right', widthWeight }, { ...symbol, align: 'center' }], { onSelect });
    };
    addOutputRow('View', view, () => output({ type: 'view' }));
    addOutputRow('Copy to the clipboard', clip, () => output({ type: 'clipboard' }));
    addOutputRow('Save to a file', file, () => output({ type: 'file' }));
  }
  private outputDone(): void {
    if (this.state.summary?.choosingOutput) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { choosingOutput, ...backSummary } = this.state.summary;
      this.summary(backSummary);
    }
    // this is called after requestOutputEditionsISBNs, too, but we don't do anything here:
    // the editions summary screen has its own "back" option at the bottom
  }
  private setEditionsServices(services?: Set<string>, restorePrevious = false): void {
    this.savePrevious();
    this.state = this.validateState(this.state.input, restorePrevious, this.state.shelf, this.state.summary, services);
    this.build();
  }
  private async buildPickEditionsServices(): Promise<void> {

    if (!this.state.editionsServices) throw 'tried to build editions services picker UI without editions services state';

    this.builder.addBackRow('Item Summary', () => this.setEditionsServices());
    this.builder.addSubtitleHelpRow('Select Editions Services', outdent`
      Books often have multiple editions, and thus multiple ISBNs. Some book lists only let you add one edition of a book, so the data will only include (at most) one ISBN for each book.

      If you are interested in finding any edition of the books in your lists, then it might be handy to be able to gather not just the ISBN of the (sometimes arbitrary) edition in your list, but also the ISBNs of other editions of that book.

      Some book websites offer a way to find the ISBNs of other editions of a book (at least the editions that those services know about). This program can use those services to gather those extra ISBNs.

      Requests to these services are limited to one per second, so it may take some time to process a large list. The results are saved for re-use though, so later queries about the same book should be faster.
    `);
    this.builder.addEmptyRow();

    const services = this.state.editionsServices;
    const serviceToggle = (service: string) => {
      const newServices = new Set(services);
      if (newServices.has(service))
        newServices.delete(service);
      else
        newServices.add(service);
      this.setEditionsServices(newServices);
    };

    (await this.controller.requestEditionsServices()).forEach(service => {
      const enabled = services.has(service);
      this.builder.addCheckableRow(service, enabled, { onSelect: () => serviceToggle(service) });
    });
    this.builder.addEmptyRow();

    if (services.size > 0) {
      const isbns = this.state.summary.isbnCount;
      this.builder.addForwardRow('Get Other Editions', async () => {

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
        a.title = 'Getting Editions May Take Some Time';
        a.message = 'Due to using external services, we limit how quickly we issue queries for other edition ISBNs. '
          + 'It will take approximately one second per queried ISBN to complete this command.\n'
          + '\n'
          + `This could be up to ${isbns} seconds for the selected items.\n`
          + '\n'
          + 'The query results are saved for later re-use, so subsequent runs will be faster (assuming some recurring ISBNs).';
        a.addCancelAction('That is too long to wait!');
        a.addAction('That is okay, I will wait.');
        const action = await a.presentAlert();
        if (action == -1) return;

        this.controller.requestEditions(Array.from(services), this.editionsProgress.bind(this)).then(s => this.editionsSummary(s));
      }, true);
      this.builder.addIndentRow('Note: Getting ISBNs of other editions will send your selected ISBNs to the above-selected third party services!', { height: 88 });
      this.builder.addIndentRow('Go back to Item Summary if you do not want to send your ISBNs to any third party services.', { height: 88 });
      this.builder.addBackRow('Item Summary', () => this.setEditionsServices());
    } else {
      this.builder.addForwardRow('Get Other Editions', void 0, true);
      this.builder.addIndentRow('One or more editions services must be selected before we can proceed.', { height: 88 });
    }
  }
  private editionsProgress(progress: EditionsProgress): void {
    this.savePrevious();
    this.state = this.validateState(this.state.input, false, this.state.shelf, this.state.summary, this.state.editionsServices, progress);
    this.build();
  }
  private buildEditionsProgress(): void {
    if (!this.state.editionsProgress) throw 'tried to build editions progress UI without editions progress';
    if (this.state.editionsSummary) throw 'tried to build progress UI after command completed';

    this.builder.addBackRow('Cancel Other Editions', async () => {
      const a = new Alert;
      a.title = 'Cancel Other Editions?';
      a.message = 'Normal operation will take approximately one second per query to finish.';
      a.addAction('Yes: Stop making queries!');
      a.addCancelAction('No: I will wait.');
      const action = await a.presentAlert();
      console.log(`progress cancel warning result: ${action}`);
      if (action == -1) return;
      this.controller.requestCancelEditions().then(() => this.editionsCanceled());
    });
    this.builder.addSubtitleHelpRow('Other Editions Progress');
    this.builder.addEmptyRow();
    this.builder.addTextRow(`Retrieving ISBNs of other editions of ISBN-bearing items on "${this.state.shelf}" shelf.`, { height: 88 });

    const { total, started, done, fetched } = this.state.editionsProgress;
    const waiting = total - started;
    const active = started - done;
    this.builder.addTextRow(`Queries:`);
    this.builder.addIndentRow(`${done} done + ${active} active + ${waiting} waiting = ${total}`);
    this.builder.addTextRow(`Fetches:`);
    this.builder.addIndentRow(`${fetched}`);
  }
  private editionsCanceled(): void {
    this.setEditionsServices(this.state.editionsServices);
  }
  private editionsSummary(summary: EditionsSummary): void {
    this.setEditionsSummary({ ...summary, received: Date.now(), both: this.previousBoth ?? false });
  }
  private setEditionsSummary(summary?: UIEditionsSummary): void {
    this.savePrevious();
    this.state = this.validateState(this.state.input, false, this.state.shelf, this.state.summary, this.state.editionsServices, summary && (this.state.editionsProgress ?? { total: 0, started: 0, done: 0, fetched: 0 }), summary);
    this.build();
  }
  private buildEditionsSummary(): void {
    if (!this.state.editionsSummary) throw 'tried to build editions summary UI without editions summary';

    const { isbns, editionsServicesSummary: summary, received, both } = this.state.editionsSummary;
    const confirmBack: () => Promise<boolean> = async () => {
      const newish = Date.now() - received < 5000;
      if (!newish) return true;
      const a = new Alert;
      a.title = `Leaving So Soon?`;
      a.message = `Other Editions just finished a few seconds ago.\n\nPlease confirm that you want to abandon these results and go back.`;
      a.addAction('Abandon these results and go back now.');
      a.addCancelAction('Do not go back yet.');
      return await a.presentAlert() != -1;
    };
    this.builder.addBackRow('Select Editions Services', async () => await confirmBack() && this.setEditionsSummary());
    this.builder.addSubtitleHelpRow(`Other Editions Summary`, outdent`
      The ISBNs of other editions of your selected items have been retrieved. The queries are summarized on this screen.

      Select an Output Option to view or save the full list of ISBNs.

      Only the ISBN-13 version of each ISBN are provided by default. Select the "Include both" option to also include the ISBN-10 version when possible (not all ISBNs have an old-style ISBN-10 version).

      The "back" option at the bottom jumps back to the input selection screen (also available through multiple taps on "back" at the top).
    `);
    this.builder.addEmptyRow();

    const shelf = this.state.shelf;
    const items = this.state.input.shelfItems[shelf] ?? 0;
    this.builder.addTextRow(`${items} items in selection ("${shelf}" shelf).`);
    this.builder.addTextRow(`${this.state.summary.isbnCount} items with an ISBN.`);
    this.builder.addTextRow(`${isbns} total ISBNs after retrieving ISBNs of other editions.`, { height: 88 });
    this.builder.addEmptyRow();

    const cached = Object.entries(summary).reduce((t, [, i]) => t + (i?.cacheHits ?? 0), 0);
    if (cached != 0)
      this.builder.addTextRow(`Reused ${cached} Other Editions query results.`);

    Object.entries(summary).forEach(([service, info]) => {
      if (!info) return;
      this.builder.addTextRow(`${service}`);
      this.builder.addIndentRow((info.cacheHits != 0 ? `${info.cacheHits} reused results, ` : '') + `${info.queries} new queries`);
      if (info.fetches != 0) {
        this.builder.addIndentRow(`${info.fetches} fetches ${info.fetchRate.toFixed(3)}/s`);
        this.builder.addIndentRow(`${info.fetchStats.min}/${info.fetchStats.median}/${info.fetchStats.max} (ms min/median/max)`);
      }
    });

    this.builder.addEmptyRow();
    const s = this.state.editionsSummary;
    const toggleBoth = () => this.setEditionsSummary({ ...s, both: !both });
    this.buildSharedOutput(
      output => this.controller.requestOutputEditionsISBNs(both, output).then(() => this.outputDone()),
      () => this.builder.addCheckableRow('Include both ISBN-10 and ISBN-13?', both, { onSelect: toggleBoth })
    );

    this.builder.addEmptyRow();
    this.builder.addBackRow('Choose New Input', async () => await confirmBack() && this.input());

  }
  async present(...args: Parameters<UITable['present']>): ReturnType<UITable['present']> {
    this.presented = true;
    try {
      return await this.table.present(...args);
    } finally {
      this.presented = false;
      this.saveData();
    }
  }
}
