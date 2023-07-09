// helper that builds common patterns of UITable elements

import { FontMeasurer, estimatedHeightOf, heightFor, inspectEstimatedLines, type AutoWidthUIBuilder, type FontMeasures } from 'uitable-runner';
import { assertNever } from 'utils/ts-utils.js';
import { apportionWidth } from './row-width.js';

type RowOpts = { onSelect?: () => void, dismissOnSelect?: boolean, height?: number, cellSpacing?: number, backgroundColor?: Color };
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
  if (opts?.backgroundColor)
    row.backgroundColor = opts.backgroundColor;
  return row;
}
type AlignOpts = { align?: 'left' | 'center' | 'right', widthWeight?: number };
export const fontNames = Object.freeze(new Set([
  'largeTitle', 'title1', 'title2', 'title3',
  'headline', 'subheadline', // spell-checker:words subheadline
  'body', 'callout', 'footnote',
  'caption1', 'caption2',
] as const));
export type NamedFont = typeof fontNames extends Set<infer T> ? T : never;
type UndefinedFont = '__ undefined __'; // missing/undefined titleFont is somewhat irregular (non-integer points line spacing) that is not currently measured correctly, so we normally replace it with 'body' (which has a correctly measured integer points line spacing); this special value lets us actually use a missing titleFont (e.g. for demonstration purposes)
function isNamedFont(font: string): font is NamedFont {
  return (fontNames as Set<string>).has(font);
}
type TextFont = NamedFont | Font;
type TextCell = { title: string, subtitle?: string, titleFont?: TextFont | UndefinedFont, titleColor?: Color /* font+color for subtitle */ };
type CellOpts = (
  | { type: 'text' } & TextCell
  | { type: 'button', title: string, onTap: () => void }
  | { type: 'image', image: Image }
) & AlignOpts;
type WeightedCellOpts = CellOpts & { widthWeight: number };
export function textCell(text: string | TextCell, opts: Omit<TextCell, 'title'> = {}): { type: 'text' } & TextCell {
  return typeof text == 'string'
    ? { type: 'text', ...opts, title: text }
    : { type: 'text', ...opts, ...text };
}
function textFont(font: TextFont | undefined): Font {
  if (!font)
    return Font.body();
  if (typeof font == 'string' && isNamedFont(font))
    return Font[font]();
  return font;
}
function buildCell(opts: CellOpts): UITableCell {
  const cell = (() => {
    if (opts.type == 'text') {
      const cell = UITableCell.text(opts.title, opts.subtitle);
      // {titleFont: Font.body()} is not identical to {titleFont: undefined} (or titleFont missing): it is close, but does not have identical line spacing coefficients and some sizes have noticeably different letter widths; unless we are given the special "undefined, really" value, we will use body, since we know how to measure it and have observed its nice integer line spacings at all sizes
      if (opts.titleFont != '__ undefined __')
        cell.titleFont = textFont(opts.titleFont);
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
// spell-checker:words xmark checkmark questionmark arrowtriangle magnifyingglass largecircle
const knownSFSymbolNames = new Set([
  'xmark', 'checkmark',
  'checkmark.square', 'square',
  'questionmark',
  'questionmark.circle', 'questionmark.square',
  'chevron.backward', 'chevron.forward',
  'arrowtriangle.right.square.fill', 'arrowtriangle.down.square.fill',
  'magnifyingglass', 'doc.on.clipboard', 'doc',
  'gear',
  'largecircle.fill.circle', 'circle',
] as const);
type KnownSFSymbolName = typeof knownSFSymbolNames extends Set<infer T> ? T : never;
function symbolImageAndWidth(name: KnownSFSymbolName, imageHeight: number): { image: Image, width: number } {
  const image = SFSymbol.named(name).image;
  const width = Math.floor(imageHeight / image.size.height * image.size.width); // ceil is closer to previous hard-coded values, but floor should prevent slight scale variation when there is extra row height available
  return { image, width };
}
function symbolCell(name: KnownSFSymbolName, imageHeight: number): WeightedCellOpts & { rowHeight: number } {
  const { image, width: widthWeight } = symbolImageAndWidth(name, imageHeight);
  return { type: 'image', image, widthWeight, rowHeight: rowHeightForImageHeight(imageHeight) };
}
function alternateSymbols(names: readonly KnownSFSymbolName[], imageHeight: number): { symbols: (WeightedCellOpts & { rowHeight: number })[], maxSymbolWidth: number } {
  const symbols = names.map(n => symbolCell(n, imageHeight));
  const maxSymbolWidth = Math.max(...symbols.map(s => s.widthWeight));
  return { symbols, maxSymbolWidth };
}
function paddedCell(maxWidth: number, cell: WeightedCellOpts, cellSpacing = 2): WeightedCellOpts[] {
  const needed = maxWidth - cell.widthWeight;
  if (needed <= cellSpacing + 1)
    return [cell];
  if (!cell.align || cell.align == 'left')
    return [
      cell,
      { type: 'text', title: '', widthWeight: needed - cellSpacing },
    ];
  if (cell.align == 'right')
    return [
      { type: 'text', title: '', widthWeight: needed - cellSpacing },
      cell,
    ];
  if (needed < 2 * (cellSpacing + 1))
    // not enough to split between before and after...
    return [
      { type: 'text', title: '', widthWeight: needed - cellSpacing },
      cell,
    ];
  const toSplit = needed - 2 * cellSpacing;
  const before = Math.trunc(toSplit / 2);
  const after = toSplit - before;
  return [
    { type: 'text', title: '', widthWeight: before },
    cell,
    { type: 'text', title: '', widthWeight: after },
  ];
}

// 16 is "row height padding" (the part of row height that an image can not use, determined experimentally, not documented)
function imageHeightForRowHeight(rowHeight: number) { return rowHeight - 16 }
function rowHeightForImageHeight(imageHeight: number) { return imageHeight + 16 }
function rowHeight(selectable: boolean, ...rowHeights: (number | undefined)[]) {
  const max = Math.max(...rowHeights.filter((h: number | undefined): h is number => typeof h == 'number'));
  if (selectable) return Math.max(44, max); // HIG says minimum touch target is 44pt?
  else return max;
}

export class UITableBuilder implements AutoWidthUIBuilder {
  public title = 'Untitled UI';
  private constructor(public table: UITable, private fontMeasurer: FontMeasurer, fontMeasures: FontMeasures) {
    this.fontMeasureCache.set('body', fontMeasures);
  }
  static async create(table: UITable, fontMeasurer = new FontMeasurer) {
    return new UITableBuilder(table, fontMeasurer, await fontMeasurer.measureFont(Font.body()));
  }

  private _rowWidth: number | null = null;
  set rowWidth(rowWidth: number | null) {
    this._rowWidth = rowWidth;
  }
  get rowWidth(): number {
    if (this._rowWidth != null) return this._rowWidth;
    const screenSize = Device.screenSize();
    const portrait = screenSize.width < screenSize.height;
    return screenSize.width - 40 - (portrait ? 0 : 48 * 2); // XXX check other devices: any that use larger padding for either orientation?
  }

  private fontMeasureCache = new Map<NamedFont, FontMeasures>;
  set bodyFontMeasures(fontMeasures: FontMeasures) {
    const oldBody = this.fontMeasureCache.get('body');
    if (oldBody && oldBody.enWidth == fontMeasures.enWidth && oldBody.lineSpacing == fontMeasures.lineSpacing)
      return;
    this.fontMeasureCache.clear();
    this.fontMeasureCache.set('body', fontMeasures);
  }
  private async fontMeasures(font?: TextFont | UndefinedFont): Promise<FontMeasures> {
    if (!font || font == '__ undefined __') font = 'body'; // undefined/missing titleFont is not actually the same as body, but it is close (usually tighter line spacing than body, but at xSmall, it is actually looser!)
    if (typeof font == 'string' && isNamedFont(font)) {
      const cached = this.fontMeasureCache.get(font);
      if (cached) return cached;
      const fontMeasures = await this.fontMeasurer.measureFont(textFont(font));
      this.fontMeasureCache.set(font, fontMeasures);
      return fontMeasures;
    }
    return await this.fontMeasurer.measureFont(font);
  }

  private remainingWidth(widths: number[], cellSpacing = 2): number {
    return this.rowWidth - widths.reduce((t, w) => t + w, 0) - cellSpacing * widths.length;
  }

  public extraLineEvery: number | undefined;
  private async estimatedHeightOfTextCell(tc: TextCell, width: number) {
    return estimatedHeightOf(tc.title, await this.fontMeasures('body'), await this.fontMeasures(tc.titleFont), width, this.extraLineEvery);
  }
  private async defaultSymbolRowHeight() {
    const bodyFm = await this.fontMeasures();
    return heightFor(1, bodyFm, bodyFm);
  }


  public inspections = false;
  private interposeInspection(cells: readonly TextCell[], widths: readonly number[], fn?: () => void) {
    if (!this.inspections) return fn;
    return async () => {
      if (fn) {
        const a = new Alert;
        a.title = 'Inspect Line Breaks?';
        a.message = 'Line break inspection is enabled, but the row you tapped has an action it would normally perform.\n\nDo you want to inspect the text\'s line breaks, or do the row\'s normal action?';
        a.addAction('Inspect');
        a.addCancelAction('Do Normal Action');
        const r = await a.present();
        if (r == -1) return fn();
      }
      let i = 0;
      for (const cell of cells)
        await inspectEstimatedLines(cell.title, await this.fontMeasures(cell.titleFont), widths[i++]);
    };
  }

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
        a.message = `The current height is ${row.height}.\n\nEnter a new height:`;
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
  private async addCenteredTextWithExtrasRow(text: string | TextCell, left?: WeightedCellOpts & { rowHeight: number }, right?: WeightedCellOpts & { rowHeight: number }, opts?: RowOpts) {
    // this expects left and right widthWeights to be in points, not just arbitrary values
    const cells = new Array<CellOpts>;
    const sideWidth = Math.max(left?.widthWeight ?? 0, right?.widthWeight ?? 0);

    if (left)
      cells.push(...paddedCell(sideWidth, { ...left, align: 'left' }, opts?.cellSpacing));
    else if (sideWidth > 0)
      cells.push({ type: 'text', title: '', widthWeight: sideWidth });

    const tc = textCell(text);
    const textWidth = this.remainingWidth([
      ...left || sideWidth > 0 ? [sideWidth] : [],
      ...right || sideWidth > 0 ? [sideWidth] : [],
    ]);
    const height = rowHeight(!!opts?.onSelect, left?.rowHeight, right?.rowHeight, await this.estimatedHeightOfTextCell(tc, textWidth));
    cells.push({ ...tc, align: 'center', widthWeight: textWidth });

    if (right)
      cells.push(...paddedCell(sideWidth, { ...right, align: 'right' }, opts?.cellSpacing));
    else if (sideWidth > 0)
      cells.push({ type: 'text', title: '', widthWeight: sideWidth });

    return this.addRowWithCells(cells.map(buildCell), { height, ...opts, onSelect: this.interposeInspection([tc], [textWidth], opts?.onSelect) });
  }

  async addTitleConfigRow(onSelect?: () => void) {
    const gear = symbolCell('gear', imageHeightForRowHeight(await this.defaultSymbolRowHeight()));
    gear.widthWeight = Math.trunc(.75 * gear.widthWeight);
    return this.addCenteredTextWithExtrasRow(textCell(this.title, { titleFont: 'title2' }), void 0, onSelect ? gear : void 0, { onSelect });
  }

  private async addSymbolExamples() {
    const rowHeight = await this.defaultSymbolRowHeight();
    const imageHeight = imageHeightForRowHeight(rowHeight);
    knownSFSymbolNames.forEach(n => {
      const { image, width } = symbolImageAndWidth(n, imageHeight);
      console.log(n);

      console.log(image.size);
      const wScale = width / image.size.width;
      const hScale = imageHeight / image.size.height;
      console.log(`ww:${width}pt ws:${wScale.toFixed(2)} hs:${hScale.toFixed(2)}`);

      const bracket = 4;
      const widths = new Array(2 * bracket + 1).fill(0).map((...[, i]) => width - bracket + i);
      const markWidth = 5;
      const remaining = this.remainingWidth([...widths, markWidth, markWidth], 0);
      if (remaining < 1 || remaining != Math.trunc(remaining))
        console.warn('problematic remaining value: ${remaining}');
      // spell-checker:ignore descs
      const descs: WeightedCellOpts[] = widths.map(w => ({ type: 'image', image, align: 'center', widthWeight: w }));
      descs.splice(bracket, 0, { type: 'text', title: '|', align: 'right', widthWeight: markWidth });
      descs.splice(bracket + 2, 0, { type: 'text', title: '|', align: 'left', widthWeight: markWidth });
      descs.push({ type: 'text', title: '.', align: 'left', widthWeight: remaining });
      this.addRowWithCells(descs.map(buildCell), { height: rowHeight, cellSpacing: 0 });
    });
  }
  private async addFontExamples() {
    const rw = this.rowWidth;
    await Array.from(fontNames).reduce(async (p, fn) => {
      await p;
      const text = fn + ' example';
      const fm = await this.fontMeasures(fn);
      await this.addTextRow({ title: text, titleFont: fn }, { onSelect: () => inspectEstimatedLines(text, fm, rw) });
    }, Promise.resolve());
  }
  async addBackRow(text: string | TextCell, onSelect: () => void) {
    const chevron = symbolCell('chevron.backward', imageHeightForRowHeight(await this.defaultSymbolRowHeight()));
    const textWidth = this.remainingWidth([chevron.widthWeight]);
    const tc = textCell(text);
    const height = rowHeight(true, chevron.rowHeight, await this.estimatedHeightOfTextCell(tc, textWidth));
    return this.addRowWithCells([
      buildCell({ ...chevron, align: 'right' }),
      buildCell({ ...tc, align: 'left', widthWeight: textWidth }),
    ], { height, onSelect: this.interposeInspection([tc], [textWidth], onSelect) });
  }

  async addSubtitleHelpRow(subtitleCell: string | TextCell, helpLines?: string, topics?: Record<string, { text: string, link: string } | string | undefined>) {
    const tc = textCell(subtitleCell, { titleFont: 'title2' });
    const subtitle = tc.title;
    let helpFn;
    if (helpLines)
      helpFn = async () => {
        type TopicInfo = { text: string, link: string | undefined };
        const allTopics = new Array<[topic: string, info: TopicInfo]>;
        if (topics)
          Object.entries(topics).forEach(([topic, help]) => {
            if (!topic || !help) return;
            const info = typeof help == 'string' ? { text: help, link: void 0 } : help;
            allTopics.push([topic, info]);
          });
        let topic = subtitle;
        let info: TopicInfo = { text: helpLines, link: void 0 };
        allTopics.push([subtitle, info]);
        do {
          const a = new Alert;
          a.title = this.title + '\n' + subtitle + '\n' + (topic == subtitle ? '' : topic + '\n');
          a.message = info.text;
          if (info.link)
            a.addAction('open ' + topic + ' page');
          const otherTopics = allTopics.filter(([nextTopic]) => nextTopic != topic);
          otherTopics.forEach(([nextTopic]) => {
            a.addAction(nextTopic + ' Help');
          });
          a.addCancelAction('Okay');
          let pick = await a.presentSheet();
          if (pick == -1) return;
          if (info.link) {
            if (pick == 0) return Safari.open(info.link);
            pick -= 1;
          }
          [topic, info] = otherTopics[pick];
        } while (true); // eslint-disable-line no-constant-condition
      };
    const qm = symbolCell('questionmark.circle', imageHeightForRowHeight(await this.defaultSymbolRowHeight()));
    return this.addCenteredTextWithExtrasRow(tc, void 0, helpFn ? qm : void 0, { onSelect: helpFn });
  }

  addEmptyRow() {
    return this.addRow();
  }

  async addTextRow(text: string | TextCell, opts: RowOpts = {}) {
    const tc = textCell(text);
    const height = await this.estimatedHeightOfTextCell(tc, this.rowWidth);
    return this.addRowWithCells([buildCell(tc)], { height, ...opts, onSelect: this.interposeInspection([tc], [this.rowWidth], opts.onSelect) });
  }

  async addIndentRow(text: string | TextCell, opts: RowOpts = {}, leftAligned = true) {
    const tc = textCell(text);
    const cells = [
      { type: 'text', title: '', widthWeight: 1 } as const,
      { ...tc, widthWeight: 9, align: leftAligned ? 'left' : 'right' } as const,
    ];
    const [, { width: textWidth }] = apportionWidth(cells, this.rowWidth, opts.cellSpacing);
    const height = await this.estimatedHeightOfTextCell(tc, textWidth);
    if (!leftAligned)
      cells.reverse();
    return this.addRowWithCells(cells.map(buildCell), { height, ...opts, onSelect: this.interposeInspection([tc], [textWidth], opts.onSelect) });
  }

  async addForwardRow(text: string | TextCell, onSelect: (() => void) | undefined) {
    const { symbols, maxSymbolWidth } = alternateSymbols(['xmark', 'chevron.forward'], imageHeightForRowHeight(await this.defaultSymbolRowHeight()));
    const image = symbols[Number(!!onSelect)];
    const textWidth = this.remainingWidth([image.widthWeight]);
    const tc = textCell(text);
    const height = rowHeight(!!onSelect, image.rowHeight, await this.estimatedHeightOfTextCell(tc, textWidth));
    const cells = [
      { ...tc, align: 'right', widthWeight: textWidth },
      ...paddedCell(maxSymbolWidth, { ...image, align: 'left' }),
    ] as const;
    return this.addRowWithCells(cells.map(buildCell), { height, onSelect: this.interposeInspection([tc], [textWidth], onSelect) });
  }

  async addCheckableRow(text: string | TextCell, checked: boolean, onSelect: () => void, multiselect = true) {
    const imageHeight = imageHeightForRowHeight(await this.defaultSymbolRowHeight());
    const { symbols: [check, uncheck], maxSymbolWidth } = multiselect
      ? alternateSymbols(['checkmark.square', 'square'], imageHeight)
      : alternateSymbols(['largecircle.fill.circle', 'circle'], imageHeight);
    const mark = checked ? check : uncheck;
    const textWidth = this.remainingWidth([mark.widthWeight]);
    const tc = textCell(text);
    const height = rowHeight(true, mark.rowHeight, await this.estimatedHeightOfTextCell(tc, textWidth));
    const cells = [
      { ...tc, align: 'right', widthWeight: textWidth },
      ...paddedCell(maxSymbolWidth, { ...mark, align: 'left' }),
    ] as const;
    return this.addRowWithCells(cells.map(buildCell), { height, onSelect: this.interposeInspection([tc], [textWidth], onSelect) });
  }

  async adderForTextWithIconRow(iconNames: KnownSFSymbolName[]) {
    const { symbols, maxSymbolWidth } = alternateSymbols(iconNames, imageHeightForRowHeight(await this.defaultSymbolRowHeight()));
    const icons = symbols.map(s => ({ ...s, align: 'right' } as const));
    return async (text: string | TextCell, iconNumber: number, onSelect: () => void) => {
      const tc = textCell(text);
      const icon = icons[iconNumber];
      const textWidth = this.remainingWidth([icon.widthWeight]);
      const height = rowHeight(true, icon.rowHeight, await this.estimatedHeightOfTextCell(tc, textWidth));
      const cells = [
        { ...tc, widthWeight: textWidth },
        ...paddedCell(maxSymbolWidth, icon),
      ] as const;
      return this.addRowWithCells(cells.map(buildCell), { height, onSelect: this.interposeInspection([tc], [textWidth], onSelect) });
    };
  }

  adderForTableRow(columnInfo: Required<AlignOpts>[]) {
    return async (texts: (string | TextCell)[], opts: RowOpts = {}) => {
      if (texts.length != columnInfo.length)
        throw `expected ${columnInfo.length} columns, got ${texts.length}`;
      const widths = apportionWidth(columnInfo, this.rowWidth, opts.cellSpacing).map(c => c.width);
      const textCells = texts.map((text, i) => ({ ...textCell(text), ...columnInfo[i], widthWeight: widths[i] }));
      const height = (await Promise.all(textCells.map(async c =>
        this.estimatedHeightOfTextCell(c, c.widthWeight))))
        .reduce((m, h) => Math.max(m, h));
      return this.addRowWithCells(textCells.map(buildCell), { height, ...opts, onSelect: this.interposeInspection(textCells, widths, opts.onSelect) });
    };
  }
}
