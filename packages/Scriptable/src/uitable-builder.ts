// helper that builds common patterns of UITable elements

import { assertNever } from 'utils';

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
type TextCell = { title: string, subtitle?: string, titleFont?: Font, titleColor?: Color /* font+color for subtitle */ };
type CellOpts = (
  | { type: 'text' } & TextCell
  | { type: 'button', title: string, onTap: () => void }
  | { type: 'image', image: Image }
) & { align?: 'left' | 'center' | 'right', widthWeight?: number };
type WeightedCellOpts = CellOpts & { widthWeight: number };
export function textCell(text: string | TextCell, opts: Omit<TextCell, 'title'> = {}): { type: 'text' } & TextCell {
  return typeof text == 'string'
    ? { type: 'text', title: text, ...opts }
    : { type: 'text', ...text, ...opts };
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
    'gear': 9,
  };
  return { image, width: sizes[name] ?? 10 };
}
export function symbolCell(name: string): WeightedCellOpts {
  const { image, width: widthWeight } = symbolImageAndWidth(name);
  return { type: 'image', image, widthWeight };
}

export class UITableBuilder {
  constructor(private table: UITable, private title: string) { }
  private addRow(opts?: RowOpts) {
    const row = buildRow(opts);
    this.table.addRow(row);
    return row;
  }
  addHeightAdjuster(row: UITableRow, updated: (newHeight: number) => void = () => this.table.reload()): UITableRow {
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
  private addCenteredTextWithExtrasRow(text: string | Omit<TextCell, 'type'>, left?: WeightedCellOpts, right?: WeightedCellOpts, opts?: RowOpts) {
    const cells = new Array<UITableCell>;
    const sideWidth = Math.max(left?.widthWeight ?? 0, right?.widthWeight ?? 0);

    if (left)
      cells.push(buildCell({ ...left, align: 'left', widthWeight: sideWidth }));
    else if (sideWidth > 0)
      cells.push(buildCell({ type: 'text', title: '', widthWeight: sideWidth }));

    cells.push(buildCell({ ...textCell(text), align: 'center', widthWeight: 100 - 2 * sideWidth }));

    if (right)
      cells.push(buildCell({ ...right, align: 'right', widthWeight: sideWidth }));
    else if (sideWidth > 0)
      cells.push(buildCell({ type: 'text', title: '', widthWeight: sideWidth }));

    return this.addRowWithCells(cells, opts);
  }
  addTitleConfigRow(onSelect?: () => void) {
    const gear = symbolCell('gear');
    gear.widthWeight = gear.widthWeight * .75;
    return this.addCenteredTextWithExtrasRow({ title: this.title, titleFont: Font.title2(), }, void 0, onSelect ? gear : void 0, { onSelect });
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
      // gear                             9/100 22

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
    t('gear');
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
  addSubtitleHelpRow(subtitle: string, helpLines?: string, topics?: Record<string, string | undefined>) {
    const qm = symbolCell('questionmark.circle');
    let helpFn;
    if (helpLines)
      helpFn = async () => {
        const allTopics = new Array<[topic: string, help: string]>;
        if (topics)
          Object.entries(topics).forEach(([topic, help]) => {
            if (!topic || !help) return;
            allTopics.push([topic, help]);
          });
        allTopics.push([subtitle, helpLines]);
        let topic = subtitle;
        let help = helpLines;
        do {
          const a = new Alert;
          a.title = this.title + '\n' + subtitle + '\n' + (topic == subtitle ? '' : topic + '\n');
          a.message = help;
          const otherTopics = allTopics.filter(([nextTopic]) => nextTopic != topic);
          otherTopics.forEach(([nextTopic]) => {
            a.addAction(nextTopic + ' Help');
          });
          a.addCancelAction('Okay');
          const pick = await a.presentSheet();
          if (pick == -1) return;
          [topic, help] = otherTopics[pick];
        } while (true); // eslint-disable-line no-constant-condition
      };
    return this.addCenteredTextWithExtrasRow({ title: subtitle, titleFont: Font.title2(), }, void 0, helpFn ? qm : void 0, { onSelect: helpFn });
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
  addForwardRow(text: string | TextCell, onSelect: (() => void) | undefined, constantSymbolWidth = false) {
    const symbols = ['xmark', 'chevron.forward'].map(symbolCell);
    const image = symbols[Number(!!onSelect)];
    if (constantSymbolWidth)
      image.widthWeight = Math.max(...symbols.map(i => i.widthWeight));
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
  addCheckableRow(text: string, checked: boolean | undefined, onSelect: () => void) {
    const mark = buildCell((() => {
      const check = symbolCell('checkmark.square');
      const uncheck = symbolCell('square');
      const widthWeight = Math.max(check.widthWeight, uncheck.widthWeight);
      if (typeof checked == 'undefined') return { type: 'text', title: '', widthWeight };
      const symbol = checked ? check : uncheck;
      return { ...symbol, align: 'left', widthWeight };
    })());
    const textCell = buildCell({ type: 'text', title: text, align: 'right', widthWeight: 100 - mark.widthWeight });
    return this.addRowWithCells([textCell, mark], { onSelect });
  }
  addRowWithDescribedCells(cellDescs: readonly CellOpts[], opts: RowOpts = {}) {
    this.addRowWithCells(cellDescs.map(buildCell), opts);
  }
}

