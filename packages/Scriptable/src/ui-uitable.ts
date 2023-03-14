// UITable-based UI uses controller to do the work

import { outdent as outdentDefault } from 'outdent';
const outdent = outdentDefault({ newline: '\n' });
import production from 'consts:production';
import { type EditionsSummary, type Summary, type Input, type UIRequestReceiver, type EditionsProgress, type RequestedOutput } from './ui-types.js';
import { symbolCell, textCell, UITableBuilder } from './uitable-builder.js';

type SetState = (state: UIState) => void;

interface UIState {
  build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver): Promise<void>,
}
// no good way to tell TS that UIState should have a static title, so...
function title(state: UIState): string {
  const ctor = state.constructor;
  if (!ctor) return `< ${typeof state}?!? >`;
  const staticTitle = (ctor as unknown as Record<PropertyKey, unknown>).title;
  if (typeof staticTitle == 'string') return staticTitle;
  return `< ${ctor.name} >`;
}

type PreviousData = {
  shelf?: string,
  services?: Set<string>,
  both?: boolean,
};

export class UITableUI {
  private table = new UITable;
  private previous: PreviousData = {};
  constructor(private controller: UIRequestReceiver, private savedDataObject: Record<string, unknown>) {
    this.table.showSeparators = true;
    const restoredData = this.savedDataObject;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const shelf = restoredData.shelf as any;
    const services = restoredData.services as any;
    const both = restoredData.both as any;
    /* eslint-enable */
    this.previous.shelf = typeof shelf == 'string' ? shelf : void 0;
    this.previous.services = Array.isArray(services) ? new Set(services.filter(e => typeof e == 'string')) : void 0;
    this.previous.both = typeof both == 'boo' + 'lean' ? both : void 0;
    this.build();
  }
  private saveData() {
    this.savedDataObject.shelf = this.previous.shelf;
    this.savedDataObject.services = this.previous.services && Array.from(this.previous.services);
    this.savedDataObject.both = this.previous.both;
  }
  private builder = new UITableBuilder(this.table, 'ISBN Export Tool');
  private state: UIState = new PickInputState(this.previous);
  private async build() {
    this.table.removeAllRows();
    this.buildDebug();
    const title = this.builder.addTitleRow();
    title.isHeader = true;
    try {
      await this.state.build(this.builder, state => {
        this.state = state;
        this.build();
      }, this.controller);
    } catch (e) { console.error(e) }
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
  private presented = false;
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

class PickInputState implements UIState {
  static readonly title = 'Input Selection';
  constructor(private previous: PreviousData, private previousInput?: Input) { }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver) {
    builder.addSubtitleHelpRow(title(this), outdent`
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
    builder.addEmptyRow();
    builder.addTextRow('Where is your export data?');
    builder.addEmptyRow();
    const useInput = (input: Input) => {
      this.previousInput = input;
      setState(new PickItemsState(this, this.previous, input));
    };
    if (this.previousInput) {
      const prev = this.previousInput;
      builder.addForwardRow(textCell('already loaded', { titleColor: Color.orange() }), () => useInput(prev));
    }
    builder.addForwardRow('On the clipboard', () => controller.requestInput({ type: 'clipboard' }).then(useInput));
    builder.addForwardRow('In a saved or downloaded file', () => controller.requestInput({ type: 'file' }).then(useInput));
  }
}

class PickItemsState implements UIState {
  static readonly title = 'Item Selection';
  constructor(private back: UIState, private previous: PreviousData, public input: Input) { }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver): Promise<void> {
    builder.addBackRow(title(this.back), () => setState(this.back));
    builder.addSubtitleHelpRow(title(this), outdent`
      Start by selecting which items from the exported data we will examine. The next step will check the selection for items that are missing ISBNs.

      Currently only a whole "shelf" of items can be selected. On this screen, choose the shelf that holds the items you want to examine.
    `);
    builder.addEmptyRow();
    builder.addTextRow(`Found ${this.input.items} items in export data.`);
    builder.addTextRow('Choose the shelf to examine.');

    const pickShelf = async (shelf: string) => {
      this.previous.shelf = shelf;
      setState(new ItemsSummaryState(this, this.previous, {
        input: this.input,
        shelf,
        summary: await controller.requestShelf(shelf),
      }));
    };
    const shelfItems = this.input.shelfItems;
    const addShelfRow = (shelf: string, items: string, onSelect?: () => void, previous = false) =>
      builder.addRowWithDescribedCells([
        { type: 'text', title: shelf, widthWeight: 85, align: 'right', titleColor: previous ? Color.orange() : void 0 },
        { type: 'text', title: items, widthWeight: 15, align: 'left' },
      ], { onSelect, cellSpacing: 10 });
    addShelfRow('Shelf Name', 'Items');
    Object.getOwnPropertyNames(shelfItems)
      .forEach(shelf => addShelfRow(shelf, String(shelfItems[shelf]),
        () => pickShelf(shelf), shelf == this.previous.shelf));
  }
}

function buildOutput(builder: UITableBuilder, output: (kind: RequestedOutput) => void, buildExtraOptionRows?: () => void) {
  builder.addTextRow('Output Options');
  buildExtraOptionRows?.();
  const view = symbolCell('magnifyingglass');
  const clip = symbolCell('doc.on.clipboard');
  const file = symbolCell('doc');
  const max = Math.max(...[view, clip, file].map(s => s.widthWeight));
  [view, clip, file].forEach(s => s.widthWeight = max);
  const addOutputRow = (title: string, symbol: typeof view, onSelect: () => void) => {
    const widthWeight = 100 - symbol.widthWeight;
    builder.addRowWithDescribedCells([{ type: 'text', title, align: 'right', widthWeight }, { ...symbol, align: 'center' }], { onSelect });
  };
  addOutputRow('View', view, () => output({ type: 'view' }));
  addOutputRow('Copy to the clipboard', clip, () => output({ type: 'clipboard' }));
  addOutputRow('Save to a file', file, () => output({ type: 'file' }));
}

interface InputShelfSummary {
  get input(): Input;
  get shelf(): string;
  get summary(): Summary;
}

class ItemsSummaryState implements UIState {
  static readonly title = 'Item Summary';
  constructor(private back: UIState, private previous: PreviousData, private iss: InputShelfSummary) { }
  async build(builder: UITableBuilder, setState: SetState) {
    builder.addBackRow(title(this.back), () => setState(this.back));
    builder.addSubtitleHelpRow(title(this), outdent`
      The bulk of this program works only with ISBNs, so any item that lacks an ISBN can not be usefully processed beyond pointing out the missing ISBN.

      Items missing an ISBN often occur because the default edition is an eBook or audiobook version that happens to not use an ISBN. If you did not mean to secifically select that non-ISBN edition you can usually change the listing (e.g. Goodread's Book Details) to an ISBN-bearing edition so that its ISBN can be used by the rest of this program in a future data export.

      Every item from the provided data that does not have an ISBN is in the "Items Missing an ISBN" list. Likewise, every item that has an ISBN will contribute it to the "Item ISBNs" list.

      Each category can be viewed or saved by selecting its view/save option.

      You can use the "Select Editions Services" option to extend the list of ISBNs with those of other editions of the same work. See the help on that screen for more information.
    `);
    builder.addEmptyRow();

    const shelf = this.iss.shelf;
    const items = this.iss.input.shelfItems[shelf] ?? 0;
    const summary = this.iss.summary;
    builder.addTextRow(`${items} items in selection ("${shelf}" shelf).`);
    builder.addTextRow(`${summary.missingISBNCount} items with no ISBN.`);
    builder.addForwardRow('View/Save Items Missing an ISBN', () => setState(new OutputMissingISBNsState(this, this.iss)));
    builder.addTextRow(`${summary.isbnCount} items with an ISBN.`);
    builder.addForwardRow('View/Save Item ISBNs', () => setState(new OutputISBNsState(this, this.previous, this.iss)));
    builder.addEmptyRow();
    builder.addTextRow('Want to also include the ISBNs of other editions of the extracted item ISBNs?', { height: 88 });
    builder.addForwardRow('Select Editions Services', () => setState(new PickEditionsServicesState(this, this.previous, this.iss)));
  }
}

class OutputMissingISBNsState implements UIState {
  static readonly title = 'Items Missing an ISBN';
  constructor(private back: UIState, private iss: InputShelfSummary) { }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver) {
    builder.addBackRow(title(this.back), () => setState(this.back));
    builder.addSubtitleHelpRow(title(this),
      'Select an Output Option to view or save the full output.',
    );
    builder.addEmptyRow();

    const shelf = this.iss.shelf;
    const items = this.iss.input.shelfItems[shelf] ?? 0;
    builder.addTextRow(`${items} items in selection ("${shelf}" shelf).`);
    builder.addTextRow(`${this.iss.summary.missingISBNCount} items with no ISBN.`);

    buildOutput(builder, kind => controller.requestOutputMissing(kind).then(() => setState(this.back)));
  }
}

class OutputISBNsState implements UIState {
  static readonly title = 'Item ISBNs';
  constructor(private back: UIState, private previous: PreviousData, private iss: InputShelfSummary) { }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver) {
    builder.addBackRow(title(this.back), () => setState(this.back));
    builder.addSubtitleHelpRow(title(this), outdent`
      Select an Output Option to view or save the full output.

      Only the ISBN-13 version of each ISBN are provided by default. Select the "Include both" option to also include the ISBN-10 version when possible (not all ISBNs have an old-style ISBN-10 version).
    `);
    builder.addEmptyRow();

    const shelf = this.iss.shelf;
    const items = this.iss.input.shelfItems[shelf] ?? 0;
    const both = this.previous.both ?? false;
    const toggleBoth = () => {
      this.previous.both = !both;
      setState(this);
    };
    builder.addTextRow(`${items} items in selection ("${shelf}" shelf).`);
    builder.addTextRow(`${this.iss.summary.isbnCount} items with an ISBN.`);

    buildOutput(builder,
      kind => controller.requestOutputISBNs(both, kind).then(() => setState(this.back)),
      () => builder.addCheckableRow('Include both ISBN-10 and ISBN-13?', both, { onSelect: toggleBoth }));
  }
}

class PickEditionsServicesState implements UIState {
  static readonly title = 'Select Editions Services';
  constructor(private back: UIState, private previous: PreviousData, private iss: InputShelfSummary) { }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver): Promise<void> {
    builder.addBackRow(title(this.back), () => setState(this.back));
    builder.addSubtitleHelpRow(title(this), outdent`
      Books often have multiple editions, and thus multiple ISBNs. Some book lists only let you add one edition of a book, so the data will only include (at most) one ISBN for each book.

      If you are interested in finding any edition of the books in your lists, then it might be handy to be able to gather not just the ISBN of the (sometimes arbitrary) edition in your list, but also the ISBNs of other editions of that book.

      Some book websites offer a way to find the ISBNs of other editions of a book (at least the editions that those services know about). This program can use those services to gather those extra ISBNs.

      Requests to these services are limited to one per second, so it may take some time to process a large list. The results are saved for re-use though, so later queries about the same book should be faster.
    `);
    builder.addEmptyRow();

    const allServices = await controller.requestEditionsServices();
    const services = this.previous.services ?? new Set(allServices);
    const serviceToggle = (service: string) => {
      const newServices = new Set(services);
      if (newServices.has(service))
        newServices.delete(service);
      else
        newServices.add(service);
      this.previous.services = newServices;
      setState(this);
    };

    allServices.forEach(service => builder.addCheckableRow(service, services.has(service), { onSelect: () => serviceToggle(service) }));
    builder.addEmptyRow();

    if (services.size > 0) {
      const isbns = this.iss.summary.isbnCount;
      builder.addForwardRow('Get Other Editions', async () => {

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

        setState(new EditionsSummaryState(this, this.previous, this.iss,
          await controller.requestEditions(Array.from(services), p => this.editionsProgress(setState, p))));
      }, true);
      builder.addIndentRow('Note: Getting ISBNs of other editions will send your selected ISBNs to the above-selected third party services!', { height: 88 });
      builder.addIndentRow('Go back to Item Summary if you do not want to send your ISBNs to any third party services.', { height: 88 });
      builder.addBackRow(title(this.back), () => setState(this.back));
    } else {
      builder.addForwardRow('Get Other Editions', void 0, true);
      builder.addIndentRow('One or more editions services must be selected before we can proceed.', { height: 88 });
    }
  }
  private progressState?: EditionsProgressState;
  private editionsProgress(setState: SetState, progress: EditionsProgress) {
    if (!this.progressState) {
      this.progressState = new EditionsProgressState(this, this.iss.shelf, progress);
      setState(this.progressState);
    } else {
      this.progressState.progress(progress);
      setState(this.progressState);
    }
  }
}

class EditionsProgressState implements UIState {
  static readonly title = 'Other Editions Progress';
  constructor(private back: UIState, private shelf: string, private editionsProgress: EditionsProgress) { }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver): Promise<void> {
    builder.addBackRow('Cancel Other Editions', async () => {
      const a = new Alert;
      a.title = 'Cancel Other Editions?';
      a.message = 'Normal operation will take approximately one second per query to finish.';
      a.addAction('Yes: Stop making queries!');
      a.addCancelAction('No: I will wait.');
      const action = await a.presentAlert();
      if (action == -1) return;
      await controller.requestCancelEditions();
      setState(this.back);
    });
    builder.addSubtitleHelpRow(title(this));
    builder.addEmptyRow();

    builder.addTextRow(`Retrieving ISBNs of other editions of ISBN-bearing items on "${this.shelf}" shelf.`, { height: 88 });

    const { total, started, done, fetched } = this.editionsProgress;
    const waiting = total - started;
    const active = started - done;
    builder.addTextRow(`Queries:`);
    builder.addIndentRow(`${done} done + ${active} active + ${waiting} waiting = ${total}`);
    builder.addTextRow(`Fetches:`);
    builder.addIndentRow(`${fetched}`);
  }
  progress(progress: EditionsProgress) {
    this.editionsProgress = progress;
  }
}

type UIEditionsSummary = EditionsSummary & { received: number };

class EditionsSummaryState implements UIState {
  static readonly title = 'Other Editions Summary';
  private editionsSummary: UIEditionsSummary;
  constructor(private back: UIState, private previous: PreviousData, private iss: InputShelfSummary, editionsSummary: EditionsSummary) {
    this.editionsSummary = { ...editionsSummary, received: Date.now() };
  }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver): Promise<void> {
    const { isbns, editionsServicesSummary: summary, received } = this.editionsSummary;
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
    builder.addBackRow(title(this.back), async () => await confirmBack() && setState(this.back));
    builder.addSubtitleHelpRow(title(this), outdent`
      The ISBNs of other editions of your selected items have been retrieved. The queries are summarized on this screen.

      Select an Output Option to view or save the full list of ISBNs.

      Only the ISBN-13 version of each ISBN are provided by default. Select the "Include both" option to also include the ISBN-10 version when possible (not all ISBNs have an old-style ISBN-10 version).

      The "back" option at the bottom jumps back to the input selection screen (also available through multiple taps on "back" at the top).
    `);
    builder.addEmptyRow();

    const shelf = this.iss.shelf;
    const items = this.iss.input.shelfItems[shelf] ?? 0;
    builder.addTextRow(`${items} items in selection ("${shelf}" shelf).`);
    builder.addTextRow(`${this.iss.summary.isbnCount} items with an ISBN.`);
    builder.addTextRow(`${isbns} total ISBNs after retrieving ISBNs of other editions.`, { height: 88 });
    builder.addEmptyRow();

    const cached = Object.entries(summary).reduce((t, [, i]) => t + (i?.cacheHits ?? 0), 0);
    if (cached != 0)
      builder.addTextRow(`Reused ${cached} Other Editions query results.`);

    Object.entries(summary).forEach(([service, info]) => {
      if (!info) return;
      builder.addTextRow(`${service}`);
      builder.addIndentRow((info.cacheHits != 0 ? `${info.cacheHits} reused results, ` : '') + `${info.queries} new queries`);
      if (info.fetches != 0) {
        builder.addIndentRow(`${info.fetches} fetches ${info.fetchRate.toFixed(3)}/s`);
        builder.addIndentRow(`${info.fetchStats.min}/${info.fetchStats.median}/${info.fetchStats.max} (ms min/median/max)`);
      }
    });

    builder.addEmptyRow();
    const toggleBoth = () => {
      this.previous.both = !this.previous.both;
      setState(this);
    };
    buildOutput(
      builder,
      output => controller.requestOutputEditionsISBNs(!!this.previous.both, output),
      () => builder.addCheckableRow('Include both ISBN-10 and ISBN-13?', !!this.previous.both, { onSelect: toggleBoth })
    );

    builder.addEmptyRow();
    builder.addBackRow('Choose New Input', async () => await confirmBack() && setState(new PickInputState(this.previous, this.iss.input)));
  }
}
