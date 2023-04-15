// UITable-based UI uses controller to do the work

import { outdent as outdentDefault } from 'outdent';
const outdent = outdentDefault({ newline: '\n' });
import { type EditionsSummary, type Summary, type Input, type UIRequestReceiver, type EditionsProgress, type RequestedOutput } from './ui-types.js';
import { textCell, UITableBuilder } from './uitable-builder.js';
import production from 'consts:production';
import dependencies from 'consts:dependencies';
import { assertNever } from 'utils';

type SetState = (state: UIState) => void;

interface UIState {
  readonly hideConfig?: true,
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

type SavableData = {
  group?: { kind: string, name: string },
  services?: Set<string>,
  both?: boolean,
  editionsSlowOkay?: true | undefined,
  editionsNetwork?: boolean | undefined,
  updatesNetwork?: boolean | undefined,
  firstRun?: number,
};
type NetworkAccessPreviousKey = 'editionsNetwork' | 'updatesNetwork';

export class UITableUI {
  private table = new UITable;
  private savable: SavableData = {};
  constructor(private controller: UIRequestReceiver, private savedDataObject: Record<string, unknown>) {
    this.table.showSeparators = true;
    const restoredData = this.savedDataObject;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const group = restoredData.group as any;
    const services = restoredData.services as any;
    const both = restoredData.both as any;
    const editionsSlowOkay = restoredData.editionsSlowOkay as any;
    const editionsNetwork = restoredData.editionsNetwork as any;
    const updatesNetwork = restoredData.updatesNetwork as any;
    const firstRun = restoredData.firstRun as any;
    /* eslint-enable */
    this.savable.group = group && typeof group == 'object' && 'kind' in group && typeof group.kind == 'string' && 'name' in group && typeof group.name == 'string' ? group : void 0;
    this.savable.services = Array.isArray(services) ? new Set(services.filter(e => typeof e == 'string')) : void 0;
    this.savable.both = typeof both == 'boolean' ? both : void 0;
    this.savable.editionsSlowOkay = editionsSlowOkay == true ? true : void 0;
    this.savable.editionsNetwork = typeof editionsNetwork == 'boolean' ? editionsNetwork : void 0;
    this.savable.updatesNetwork = typeof updatesNetwork == 'boolean' ? updatesNetwork : void 0;
    this.savable.firstRun = typeof firstRun == 'number' ? firstRun : void 0;
    this.build();
  }
  private saveData() {
    this.savedDataObject.group = this.savable.group;
    this.savedDataObject.services = this.savable.services && Array.from(this.savable.services);
    this.savedDataObject.both = this.savable.both;
    this.savedDataObject.editionsSlowOkay = this.savable.editionsSlowOkay;
    this.savedDataObject.editionsNetwork = this.savable.editionsNetwork;
    this.savedDataObject.updatesNetwork = this.savable.updatesNetwork;
    this.savedDataObject.firstRun = this.savable.firstRun;
  }
  private builder = new UITableBuilder(this.table, 'ISBN Export Tool');
  private state: UIState = new UpdateState(this.savable);
  private async build() {
    this.table.removeAllRows();
    const setState = (state: UIState) => {
      defer(() => {
        this.state = state;
        this.build();
      });
    };
    const gotoConfig = (state => {
      if (state.hideConfig) return void 0;
      return () => setState(new ConfigurationState(state, this.savable));
    })(this.state);
    const title = this.builder.addTitleConfigRow(gotoConfig);
    title.isHeader = true;
    try {
      await this.state.build(this.builder, setState, this.controller);
    } catch (e) { console.error(e) }
    if (this.presented) this.table.reload();
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

class ConfigurationState implements UIState {
  static title = 'Configuration';
  readonly hideConfig = true;
  constructor(private back: UIState, private savable: SavableData) { }
  private justUpdated = false;
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver) {
    if (this.justUpdated)
      return void builder.addTextRow('Update installed. Will restart in 5 seconds.');

    builder.addBackRow(title(this.back), () => setState(this.back));
    builder.addEmptyRow();
    builder.addTextRow('Network Access Permissions');
    builder.addForwardRow('Get Other Editions', () => setState(NetworkAccess.editionsOf(this.savable).uiState(this)));
    const una = NetworkAccess.updates(this.savable);
    builder.addForwardRow('Updates', () => setState(una.uiState(this)));
    builder.addEmptyRow();
    builder.addForwardRow('check for updates now', async () => {
      if (!await controller.requestUpdateCheck(true)) {
        const a = new Alert;
        a.title = 'No Update Available';
        a.message = 'No update for this program is currently available.';
        a.addCancelAction('Okay');
        a.presentAlert();
      } else if (await askUpdateInstall(una, controller)) {
        this.justUpdated = true;
        setState(this);
      }
    });
    builder.addEmptyRow();
    builder.addTextRow('Acknowledgeable Warnings');
    builder.addForwardRow('Get Other Editions is slow', () => setState(new EditionsAcknowledgementState(this.back, this.savable)));
    builder.addEmptyRow();
    builder.addTextRow('Other Settings');
    builder.addForwardRow('debug-only stuff', () => controller.debugUI().then(() => setState(this)));
    if (production) {
      builder.addEmptyRow();
      builder.addForwardRow('Copyrights', () => setState(new CopyrightsState(this)));
    }
  }
}

class CopyrightsState implements UIState {
  static title = 'Copyrights';
  readonly hideConfig = true;
  constructor(private back: UIState) { }
  async build(builder: UITableBuilder, setState: SetState): Promise<void> {
    builder.addBackRow(title(this.back), () => setState(this.back));
    builder.addTextRow('tap a row for full license text');
    builder.addEmptyRow();
    const addTableRow = builder.adderForTableRow([
      { align: 'left', widthWeight: 2 },
      { align: 'center', widthWeight: 1 },
      { align: 'right', widthWeight: 1 },
    ]);
    const addRow = (name: string, version: string, license: string, licenseText: string) =>
      addTableRow([name, version, license], {
        onSelect: licenseText ? async () => {
          const a = new Alert;
          a.title = name + ' License';
          a.message = licenseText;
          a.addCancelAction('Okay');
          await a.presentAlert();
        } : void 0
      });
    addTableRow(['Included Dependency', 'Version', 'License']);
    dependencies.forEach(d => addRow(d.name ?? '', d.version ?? '', d.license ?? '', d.licenseText ?? ''));
  }
}

async function askUpdateInstall(na: NetworkAccess, controller: UIRequestReceiver): Promise<boolean> {
  const a = new Alert;
  a.title = 'Install Update?';
  a.message = 'An updated version of this program is ready to be installed.\n\nAutomatic checks for updates can be disabled in the configuration settings (gear icon on the title row).\n\nDo you want to install this update now?\nBefore the update can be launched, you will need to exit the current session, and close the JavaScript code view if it is open.';
  a.addAction('Yes'); // 0
  a.addCancelAction('Not now');
  a.addAction('Never'); // 1
  const s = await a.presentAlert();

  if (s == -1) // not now
    return false;
  else if (s == 0) // yes
    return await controller.requestUpdateInstall();
  else if (s == 1) { // never
    na.set(false);
    controller.clearPendingUpdate();
    return false;
  }
  return false;
}
class UpdateState implements UIState {
  static readonly title = 'Starting…'; // not "Update Check" or similar to avoid confusion if update network permission is denied
  readonly hideConfig = true;
  constructor(private savable: SavableData) { }
  private justUpdated = false;
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver): Promise<void> {
    const pickInput = () => setState(new PickInputState(this.savable));

    if (!production) return pickInput();

    if (Date.now() < this.firstRun() + 1000 * 60 * 60 * 24 * 7)
      return pickInput();

    if (this.justUpdated)
      return void builder.addTextRow('Update installed. Will restart in 5 seconds.');

    builder.addSubtitleHelpRow(title(this));

    const na = NetworkAccess.updates(this.savable);
    const status = controller.updateStatus();
    if (status == 'dormant')
      return pickInput();
    else if (status == 'pending') {
      builder.addTextRow('An update is ready for installation.');
      return defer(async () => { // defer to keep Alert "above" initial UITable
        if (await askUpdateInstall(na, controller)) {
          this.justUpdated = true;
          setState(this);
        } else
          pickInput();
      });
    } else if (status == 'expired') {
      if (na.denied())
        return pickInput();
      builder.addTextRow('Checking for update (up to 10 seconds)…');
      return defer(async () => { // defer to keep Alert "above" initial UITable
        if (await na.askAllowed(true)
          && await Promise.race([
            controller.requestUpdateCheck(),
            new Promise(resolve => Timer.schedule(10 * 1000, false, () => resolve(false)))
          ])
          && controller.updateStatus() == 'pending')
          setState(this);
        else
          pickInput();
      });
    } else assertNever(status);
  }
  private firstRun(): number {
    if (typeof this.savable.firstRun == 'undefined')
      this.savable.firstRun = Date.now();
    return this.savable.firstRun;
  }
}

class PickInputState implements UIState {
  static readonly title = 'Input Selection';
  constructor(private savable: SavableData, private previousInput?: Input) { }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver) {
    builder.addSubtitleHelpRow(title(this), outdent`
      This program reads exported book list data to let you access the ISBNs of your listed items.

      You can review the items that are missing ISBNs, and view or save the list of ISBNs (optionally including ISBNs of other editions of the listed book).

      Some libraries can import such an ISBN list and use it to show which of those books they have available in their holdings (e.g. which of your "To Be Read" list is available for checkout).

      These book list export formats are currently supported:
      - Goodreads export (CSV with a specific set of columns) and its Shelves
      - LibraryThing TSV export and its Collections and Tags
      Suggest your favorite book list format for support in future versions!

      When you have your data ready, tell us where to find it using the selections on this Input Selection screen.
    `, {
      'Goodreads Export': outdent`
      Exporting from Goodreads can be done on the Goodreads website:


      Login.

      If on a mobile device, tap/click the "Desktop version" link in the footer of the website.

      Tap/click on the "My Books" tab.

      In the left sidebar, find the "Tools" section and tap/click on "Import and Export" link.

      On the Import/Export page tap/click the "Export Library" button at the top of the page.

      A link like "Your export from <date>" will appear when the export is ready.


      Once the export is ready, you can download the file (it will be in the Files app in your Downloads folder), or view the data in your web browser and use Select All and Copy to copy it to the clipboard.
    `,
      'LibraryThing Export': outdent`
      Exporting from LibraryThing can be done on the LibraryThing website:


      Login.

      Tap/click the "More" top tab (inside three-horizontal-lines ("hamburger" menu) in the mobile view).

      In the "Useful and Fun" section, tap/click the "Import/Export" link.

      In the "Export from LibraryThing" section, tap/click the "Export as tab-delimited text" link.

      Tap/click the "Export all books" button, or fill out a filter and tap/click the "Export filtered" button.

      A "Download" button will appear when the export is ready.


      Once the export is ready, you can download the file (it will be in the Files app in your Downloads folder), or view the data in your web browser and use Select All and Copy to copy it to the clipboard.
    `});
    builder.addEmptyRow();
    builder.addTextRow('Where is your export data?');
    builder.addEmptyRow();
    const useInput = (input: Input) => {
      this.previousInput = input;
      setState(new PickItemsState(this, this.savable, input));
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
  constructor(private back: UIState, private savable: SavableData, public input: Input) { }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver) {
    builder.addBackRow(title(this.back), () => setState(this.back));
    builder.addSubtitleHelpRow(title(this), outdent`
      Start by selecting which items from the exported data we will examine. The next step will check the selection for items that are missing ISBNs.

      Currently only a whole groups of items (shelves, collections, tags) can be selected. On this screen, choose the group that holds the items you want to examine.
    `);
    builder.addEmptyRow();
    builder.addTextRow(`Found ${this.input.items} items in export data.`);
    builder.addTextRow('Choose the group to examine.');

    const pickGroup = async (kind: string, name: string) => {
      this.savable.group = { kind, name };
      setState(new ItemsSummaryState(this, this.savable, {
        input: this.input,
        group: { kind, name },
        summary: await controller.requestGroup(kind, name),
      }));
    };
    const groupItems = this.input.groupItems;
    const addTableRow = builder.adderForTableRow([
      { widthWeight: 30, align: 'left' },
      { widthWeight: 55, align: 'right' },
      { widthWeight: 15, align: 'left' },
    ]);
    const addGroupRow = (kind: string, name: string, items: string, onSelect?: () => void, previous = false) =>
      addTableRow([kind, { title: name, titleColor: previous ? Color.orange() : void 0 }, items], { onSelect, cellSpacing: 10 });
    addGroupRow('Kind', 'Group', 'Items');
    Object.entries(groupItems)
      .forEach(([kind, groupCounts]) => Object.getOwnPropertyNames(groupCounts).forEach(
        group => addGroupRow(kind, group, String(groupItems[kind]?.[group]),
          () => pickGroup(kind, group), kind == this.savable.group?.kind && group == this.savable.group.name)));
  }
}

function buildOutput(builder: UITableBuilder, output: (kind: RequestedOutput) => void, buildExtraOptionRows?: () => void) {
  builder.addTextRow('Output Options');
  buildExtraOptionRows?.();
  // spell-checker:words magnifyingglass
  const addOutputRow = builder.adderForTextWithIconRow(['magnifyingglass', 'doc.on.clipboard', 'doc']);
  addOutputRow('View', 0, () => output({ type: 'view' }));
  addOutputRow('Copy to the clipboard', 1, () => output({ type: 'clipboard' }));
  addOutputRow('Save to a file', 2, () => output({ type: 'file' }));
}

interface InputGroupSummary {
  get input(): Input;
  get group(): { kind: string, name: string };
  get summary(): Summary;
}

class ItemsSummaryState implements UIState {
  static readonly title = 'Item Summary';
  constructor(private back: UIState, private savable: SavableData, private igs: InputGroupSummary) { }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver) {
    builder.addBackRow(title(this.back), () => setState(this.back));
    builder.addSubtitleHelpRow(title(this), outdent`
      The bulk of this program works only with ISBNs, so any item that lacks an ISBN can not be usefully processed beyond pointing out the missing ISBN.

      Items missing an ISBN often occur because the default edition is an eBook or audio book version that happens to not use an ISBN. If you did not mean to specifically select that non-ISBN edition you can usually change the listing (e.g. Goodreads' Book Details) to an ISBN-bearing edition so that (in a future data export) its ISBN can be used by the rest of this program.

      Every item from the provided data that does not have an ISBN is in the "Items Missing an ISBN" list. Likewise, every item that has an ISBN will contribute it to the "Item ISBNs" list.

      Each category can be viewed or saved by selecting its view/save option.

      You can use the "Select Editions Services" option to extend the list of ISBNs with those of other editions of the same work. See the help on that screen for more information.
    `);
    builder.addEmptyRow();

    const group = this.igs.group;
    const items = this.igs.input.groupItems[group.kind]?.[group.name] ?? 0;
    const summary = this.igs.summary;
    builder.addTextRow(`${items} items in selection (${group.kind} ${group.name}).`);
    builder.addTextRow(`${summary.missingISBNCount} items with no ISBN.`);
    builder.addForwardRow('View/Save Items Missing an ISBN', () => setState(new OutputMissingISBNsState(this, this.igs)));
    builder.addTextRow(`${summary.isbnCount} items with an ISBN.`);
    builder.addForwardRow('View/Save Item ISBNs', () => setState(new OutputISBNsState(this, this.savable, this.igs)));
    builder.addEmptyRow();
    builder.addTextRow('Want to also include the ISBNs of other editions of the extracted item ISBNs?', { height: 88 });
    const na = NetworkAccess.editionsOf(this.savable);
    builder.addForwardRow('Select Editions Services', na.denied() ? void 0 : async () => {
      if (await na.askAllowed() == false) {
        const a = new Alert;
        a.title = 'Network Access Disallowed!';
        a.message = 'We will not be able to get other edition ISBNs without your permission to access the Internet.\n\nWe need be able to:\n ① ask whether any of the editions services should be disabled, and\n ② send your selected ISBNs to the editions services to ask them for the ISBNs of other editions.';
        a.addCancelAction('Okay');
        await a.presentAlert();
        return;
      }
      setState(new PickEditionsServicesState(this, this.savable, this.igs, await controller.requestEditionsServices()));
    });
    if (na.denied())
      builder.addIndentRow('Network Access must not be disallowed before we can proceed.', { height: 88 });
    na.addRow(this, builder, setState);
  }
}

class OutputMissingISBNsState implements UIState {
  static readonly title = 'Items Missing an ISBN';
  constructor(private back: UIState, private igs: InputGroupSummary) { }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver) {
    builder.addBackRow(title(this.back), () => setState(this.back));
    builder.addSubtitleHelpRow(title(this),
      'Select an Output Option to view or save the full output.',
    );
    builder.addEmptyRow();

    const group = this.igs.group;
    const items = this.igs.input.groupItems[group.kind]?.[group.name] ?? 0;
    builder.addTextRow(`${items} items in selection (${group.kind} ${group.name}).`);
    builder.addTextRow(`${this.igs.summary.missingISBNCount} items with no ISBN.`);

    buildOutput(builder, kind => controller.requestOutputMissing(kind).then(() => setState(this.back)));
  }
}

class OutputISBNsState implements UIState {
  static readonly title = 'Item ISBNs';
  constructor(private back: UIState, private savable: SavableData, private igs: InputGroupSummary) { }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver) {
    builder.addBackRow(title(this.back), () => setState(this.back));
    builder.addSubtitleHelpRow(title(this), outdent`
      Select an Output Option to view or save the full output.

      Only the ISBN-13 version of each ISBN is provided by default. Select the "Include both" option to also include the ISBN-10 version when possible (not all ISBNs have an old-style ISBN-10 version).
    `);
    builder.addEmptyRow();

    const group = this.igs.group;
    const items = this.igs.input.groupItems[group.kind]?.[group.name] ?? 0;
    const both = this.savable.both ?? false;
    const toggleBoth = () => {
      this.savable.both = !both;
      setState(this);
    };
    builder.addTextRow(`${items} items in selection (${group.kind} ${group.name}).`);
    builder.addTextRow(`${this.igs.summary.isbnCount} items with an ISBN.`);

    buildOutput(builder,
      kind => controller.requestOutputISBNs(both, kind).then(() => setState(this.back)),
      () => builder.addCheckableRow('Include both ISBN-10 and ISBN-13?', both, toggleBoth));
  }
}

class PickEditionsServicesState implements UIState {
  static readonly title = 'Select Editions Services';
  constructor(private back: UIState, private savable: SavableData, private igs: InputGroupSummary, private availableServices: readonly string[]) { }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver) {
    builder.addBackRow(title(this.back), () => setState(this.back));
    builder.addSubtitleHelpRow(title(this), outdent`
      Books often have multiple editions, and thus multiple ISBNs. Some book lists only let you add one edition of a book, so the data will only include (at most) one ISBN for each book.

      If you are interested in finding any edition of the books in your lists, then it might be handy to be able to gather not just the ISBN of the (sometimes arbitrary) edition in your list, but also the ISBNs of other editions of that book.

      Some book-data websites offer a way to find the ISBNs of other editions of a book (at least the editions that those services know about). We can use those services to gather those extra ISBNs.

      Requests to these services are limited to one per second, so it may take some time to process a large list. We save the results for re-use though, so later queries about the same book should be faster.
    `);
    builder.addEmptyRow();

    const services = this.savable.services ?? new Set(this.availableServices);
    const serviceToggle = (service: string) => {
      const newServices = new Set(services);
      if (newServices.has(service))
        newServices.delete(service);
      else
        newServices.add(service);
      this.savable.services = newServices;
      setState(this);
    };

    this.availableServices.forEach(service => builder.addCheckableRow(service, services.has(service), () => serviceToggle(service)));
    builder.addEmptyRow();

    if (services.size > 0) {
      const isbns = this.igs.summary.isbnCount;
      builder.addForwardRow('Get Other Editions', async () => {
        const wv = new WebView;
        await wv.loadHTML('');
        const online = await wv.evaluateJavaScript('navigator.onLine');
        if (!online) {
          const a = new Alert;
          a.title = 'Device Offline?';
          a.message = 'This device appears to be offline.\n\nPlease make sure you have an Internet connection before using "Get Other Editions".';
          a.addCancelAction('Okay');
          await a.presentAlert();
          return;
        }

        if (!await acknowledgeEditionsIsSlow(this.savable, isbns))
          return;

        setState(new EditionsSummaryState(this, this.savable, this.igs,
          await controller.requestEditions(Array.from(services), p => this.editionsProgress(setState, p))));
      });
    } else {
      builder.addForwardRow('Get Other Editions', void 0);
      if (services.size <= 0)
        builder.addIndentRow('One or more editions services must be selected before we can proceed.', { height: 88 });
    }
  }
  private progressState?: EditionsProgressState;
  private editionsProgress(setState: SetState, progress: EditionsProgress) {
    if (!this.progressState) {
      this.progressState = new EditionsProgressState(this, this.igs.group, progress);
      setState(this.progressState);
    } else {
      this.progressState.progress(progress);
      setState(this.progressState);
    }
  }
}

const editionsThrottled =
  'Due to using external services, we limit how quickly we issue queries for other edition ISBNs. It will take approximately one second per queried ISBN to finish.';
const editionsCached =
  'We save the query results for later re-use, so subsequent runs will be faster (assuming some recurring ISBNs).';

async function acknowledgeEditionsIsSlow(savable: SavableData, isbns: number): Promise<boolean> {
  if (savable.editionsSlowOkay) return true;
  const a = new Alert;
  a.title = 'Getting Editions May Take Some Time';
  a.message = outdent`
      ${editionsThrottled}

      This could be up to ${isbns} seconds for the selected items.

      ${editionsCached}
    `;
  a.addAction('I will wait; do not tell me again.');
  a.addAction('I will wait.');
  a.addCancelAction('That is too long to wait!');

  const action = await a.presentAlert();
  if (action == 0) {
    savable.editionsSlowOkay = true;
    return true;
  } else if (action == 1)
    return true;
  return false;
}

class EditionsAcknowledgementState implements UIState {
  static title = '"Get Other Editions" Is Slow';
  readonly hideConfig = true;
  constructor(private back: UIState, private savable: SavableData) { }
  async build(builder: UITableBuilder, setState: SetState) {
    builder.addBackRow(title(this.back), () => setState(this.back));
    builder.addSubtitleHelpRow(title(this), 'You can select the "do not warn me" option here to skip the warning.');
    builder.addEmptyRow();
    builder.addTextRow(editionsThrottled, { height: 132 });
    builder.addTextRow(editionsCached, { height: 88 });
    builder.addEmptyRow();
    builder.addTextRow('Do you want to be warned every time about this?');
    const set = (value: true | undefined) => {
      this.savable.editionsSlowOkay = value;
      setState(this);
    };
    // spell-checker:ignore acked
    const acked = this.savable.editionsSlowOkay;
    builder.addCheckableRow('Yes, warn me every time.', !acked, () => set(void 0), false);
    builder.addCheckableRow('No, do not warn me.', !!acked, () => set(true), false);
  }
}

class PreviousNetworkPermission {
  constructor(protected savable: SavableData, private key: NetworkAccessPreviousKey) { }
  get netPermission(): boolean | undefined {
    return this.savable[this.key];
  }
  set netPermission(value: boolean | undefined) {
    this.savable[this.key] = value;
  }
  denied(): boolean {
    return this.netPermission == false;
  }
}

class NetworkAccess {
  static editionsOf(savable: SavableData) {
    return new NetworkAccess(savable, 'editionsNetwork', 'get ISBNs of other editions',
      'Before we can ask about other editions of books, we need to know if any of the services we normally use have become unavailable.\n\n❗ No personal information will be sent for this purpose, we will only request a list of affected services.\n\n\nThen, to get the ISBNs of other editions, we will send your selected ISBNs to external services (Open Library and/or LibraryThing as per your selection).\n\n❗ Only ISBNs of your selected items will be sent. No other information, personal or otherwise will be sent.', 352);
  }
  static updates(savable: SavableData) {
    return new NetworkAccess(savable, 'updatesNetwork', 'check for updates',
      'We can periodically check for updates to this program.\n\n❗ No personal information will be sent for this purpose, we will only request the most recent version of this program.', 132);
  }
  private savable: PreviousNetworkPermission;
  private constructor(savable: SavableData, key: NetworkAccessPreviousKey, private actionText: string, private text: string, private height: number) {
    this.savable = new PreviousNetworkPermission(savable, key);
  }
  denied() { return this.savable.denied() }
  set(value: boolean | undefined) { this.savable.netPermission = value }
  uiState(back: UIState) {
    return new NetworkAccessState(back, this.savable, this.actionText, this.text, this.height);
  }
  addRow(back: UIState, builder: UITableBuilder, setState: SetState) {
    const perm = this.savable.netPermission;
    const na = perm == true
      ? 'granted'
      : perm == false
        ? 'denied'
        : 'will ask';
    builder.addForwardRow({
      title: 'Network Access: ' + na,
      titleColor: na == 'denied' ? Color.red() : void 0
    }, () => setState(this.uiState(back)));
  }
  async askAllowed(configOnly = false): Promise<boolean> {
    const perm = this.savable.netPermission;
    if (typeof perm == 'boolean') return perm;
    const a = new Alert;
    a.title = 'Allow Network Access?';
    const controlText = configOnly
      ? 'Use the gear icon on the title to control the default permission.'
      : 'Use the Network Access item (or the gear icon on the title) to control the default permission.';
    a.message = this.text + '\n\n' + controlText + '\n\n'
      + 'Do you want to allow this program to use the Internet to ' + this.actionText + '?';
    a.addAction('Yes, use the Internet');
    a.addCancelAction('No, do not use the Internet');
    const c = await a.presentAlert();
    if (c == -1) // no
      return false;
    else if (c == 0) // yes
      return true;
    return false;
  }
}

class NetworkAccessState implements UIState {
  static readonly title = 'Network Access';
  readonly hideConfig = true;
  constructor(private back: UIState, private savable: PreviousNetworkPermission, private actionText: string, private text: string, private height: number) { }
  async build(builder: UITableBuilder, setState: SetState) {
    builder.addBackRow(title(this.back), () => setState(this.back));
    builder.addSubtitleHelpRow(title(this), outdent`
      Some portions of this program need to access the Internet, however it will never access any network without your permission.

      By default, this program will ask for your permission each time it needs to access the Internet.

      You can use this screen to grant permission (allow access without asking), reserve permission (the default: ask each time), or deny permission (deny access without asking).

      You can change these settings at any time.
    `);
    builder.addEmptyRow();
    builder.addTextRow(this.text, { height: this.height });
    builder.addTextRow(`Would you like to grant, reserve, or deny permission to access the Internet to ${this.actionText}?`, { height: 88 });
    const allowed = this.savable.netPermission;
    const set = (n: typeof this.savable.netPermission) => {
      this.savable.netPermission = n;
      setState(this);
    };
    builder.addCheckableRow('Grant permission: Always allow.', allowed == true, () => set(true), false);
    builder.addCheckableRow('Reserve permission: Ask each time.', allowed == null, () => set(void 0), false);
    builder.addCheckableRow('Deny permission: Never allow.', allowed == false, () => set(false), false);
  }
}

class EditionsProgressState implements UIState {
  static readonly title = 'Other Editions Progress';
  constructor(private back: UIState, private group: { kind: string, name: string }, private editionsProgress: EditionsProgress) { }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver) {
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

    builder.addTextRow(`Retrieving ISBNs of other editions of ISBN-bearing items on ${this.group.kind} ${this.group.name}.`, { height: 88 });

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
  constructor(private back: UIState, private savable: SavableData, private igs: InputGroupSummary, editionsSummary: EditionsSummary) {
    this.editionsSummary = { ...editionsSummary, received: Date.now() };
  }
  async build(builder: UITableBuilder, setState: SetState, controller: UIRequestReceiver) {
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

      Only the ISBN-13 version of each ISBN is provided by default. Select the "Include both" option to also include the ISBN-10 version when possible (not all ISBNs have an old-style ISBN-10 version).

      The "back" option at the bottom jumps back to the input selection screen (also available through multiple taps on "back" at the top).
    `);
    builder.addEmptyRow();

    const group = this.igs.group;
    const items = this.igs.input.groupItems[group.kind]?.[group.name] ?? 0;
    builder.addTextRow(`${items} items in selection (${group.kind} ${group.name}).`);
    builder.addTextRow(`${this.igs.summary.isbnCount} items with an ISBN.`);
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
      this.savable.both = !this.savable.both;
      setState(this);
    };
    buildOutput(
      builder,
      output => controller.requestOutputEditionsISBNs(!!this.savable.both, output),
      () => builder.addCheckableRow('Include both ISBN-10 and ISBN-13?', !!this.savable.both, toggleBoth)
    );

    builder.addEmptyRow();
    builder.addBackRow('Choose New Input', async () => await confirmBack() && setState(new PickInputState(this.savable, this.igs.input)));
  }
}

function defer(fn: () => void): void {
  Timer.schedule(0, false, fn);
}
