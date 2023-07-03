import production from 'consts:production';
import * as t from 'typanion';
import { buildSourceAndLicenses } from './build-source-and-licenses.js';
import { AutoHeightUIRunner } from './lib/auto-height-ui-runner.js';
import { type FontMeasurer, type FontMeasures } from './lib/measure.js';
import { apportionWidth } from './lib/row-width.js';
import { rulerImage } from './lib/ruler-image.js';
import { Store, asidePathname, localTempfile } from './lib/scriptable-utils.js';
import { estimatedHeightOf, heightFor } from './lib/text-height.js';
import { fontNames, textCell, type NamedFont } from './lib/uitable-builder.js';

async function main() {
  for (let saiWebViewBehind = false; ; saiWebViewBehind = !saiWebViewBehind)
    if (!await main2(saiWebViewBehind)) return;
}

async function main2(saiWebViewBehind: boolean) {

  const ui = await AutoHeightUIRunner.start({ visibleSafeAreaInsetWebView: saiWebViewBehind });
  let padding: PortraitAndLandscape<Padding> & { source: 'loaded previous measure' | 'measured' | 'default' } = {
    source: 'default',
    portrait: { heightPadding: 16, widthPadding: 40 },
    landscape: { heightPadding: 16, widthPadding: 40 + 48 * 2 },
  };

  const builder = ui.builder;

  await loadPadding();

  if (padding.source == 'default')
    if (!await measurePadding())
      return; // table closed

  const insetsStatusLog: PortraitAndLandscape<{ times: number, matches: number }> = {
    portrait: { times: 0, matches: 0 },
    landscape: { times: 0, matches: 0 },
  };

  let n = 0; // debug counter
  const screenScale = Device.screenScale();
  const runAgain = await ui.loop<true>(async (loop, { safeAreaInsets }) => {
    builder.title = 'Automatic Row Height Demonstrations ' + n++;
    const screenSize = Device.screenSize();

    await builder.addTitleConfigRow();
    builder.addEmptyRow();

    const orientation = orientationName(screenSize);
    const insetStatus = (function checkAndLogInsetsStatus() {
      const log = insetsStatusLog[orientation];
      log.times++;
      const wp = padding[orientation].widthPadding;
      if (!(isFinite(safeAreaInsets.left) && isFinite(safeAreaInsets.right))) {
        console.error(`unusable insets: ${JSON.stringify(safeAreaInsets)}`);
        return 'insets not usable';
      }
      if (wp != 40 + safeAreaInsets.left + safeAreaInsets.right) {
        console.error(`insets do not match padding: ${JSON.stringify(safeAreaInsets)} vs. padding ${wp} for width ${screenSize.width}`);
        return 'insets do not match padding';
      }
      log.matches++;
      return 'insets match padding';
    })();

    const goodOpts = { backgroundColor: Color.blue() };
    const warnOpts = { backgroundColor: Color.yellow() };
    const errorOpts = { backgroundColor: Color.red() };

    const orientations = ['portrait', 'landscape'] as const;
    const statuses = mapPnLs([insetsStatusLog], l => l.times == 0
      ? 'untried'
      : l.matches / l.times >= 0.9
        ? 'good'
        : 'bad');
    const eachUntriedOrOkay = orientations.every(o => statuses[o] == 'untried' || statuses[o] == 'good');
    await builder.addTextRow('Insets/Padding Match Status', eachUntriedOrOkay ? {} : errorOpts);
    for (const orientation of orientations) {
      const log = insetsStatusLog[orientation];
      const opts = (() => {
        const s = statuses[orientation];
        if (s == 'untried') return warnOpts;
        else if (s == 'good') return goodOpts;
        else return errorOpts;
      })();
      await builder.addIndentRow(`${orientation} ${log.matches} of ${log.times} times${log.times == 0 ? `\n(please try the ${orientation} orientation, too)` : ''}`, opts);
    }
    builder.addEmptyRow();

    await builder.addForwardRow('Show Line Breaks', () => showLineBreaks(ui));
    // XXX show comparisons: native text block vs. "our" breaking (and rendering?)
    builder.addEmptyRow();

    const measurePaddings = padding.source == 'default' ? 'Measure Paddings' : 'Re-measure Paddings';
    await builder.addForwardRow(measurePaddings, () => measurePadding());
    await builder.addForwardRow('Show Safe Area Insets', () => showSafeAreaInsets(ui));
    await builder.addForwardRow('Measure Row Height for N Lines', () => measureHeights(ui));
    await builder.addForwardRow('Measure Fonts', () => measureFonts(ui));
    builder.addEmptyRow();

    await builder.addForwardRow('Measure Paddings By Moiré', () => measurePaddingByMoire());
    await builder.addIndentRow(textCell('This technique is probably more difficult to use than the default "gap" technique. The first step requires subtle discernment that may not be obvious unless you already know what to look for.', { titleFont: 'footnote' }));
    builder.addEmptyRow();

    await builder.addForwardRow('Toggle "Visibility" of Safe Area Inset WebView', () => loop.return(true));
    builder.addEmptyRow();

    const infoOpts = { backgroundColor: Color.gray() };
    await builder.addTextRow(`device: ${Device.model()} (${Device.isPhone() ? 'phone' : Device.isPad() ? 'pad' : 'other'}) ${Device.systemName()} ${Device.systemVersion()}`, infoOpts);
    await builder.addTextRow(`device W×H: ${screenSize.width}×${screenSize.height}pt ${screenScale}× scale`, infoOpts);
    await builder.addTextRow(`safe area insets (pt): left:${safeAreaInsets.left} right:${safeAreaInsets.right}`, insetStatus == 'insets match padding' ? infoOpts : goodOpts);
    if (insetStatus == 'insets do not match padding') {
      await builder.addTextRow('INSETS DO NOT MATCH WIDTH PADDING', errorOpts);
      if (padding.source == 'default')
        await builder.addTextRow('Please try using "Measuring Paddings" to measure this device\'s row paddings.', errorOpts);
    }
    if (padding.portrait.heightPadding == padding.landscape.heightPadding)
      await builder.addTextRow(`UITableRow (image) height padding (pt): ${padding.portrait.heightPadding}`, infoOpts);
    else
      await builder.addTextRow(`UITableRow (image) height paddings (pt): P ${padding.portrait.heightPadding} != L ${padding.landscape.heightPadding}`, errorOpts);
    await builder.addTextRow(`UITableRow (image) width paddings (pt): P ${padding.portrait.widthPadding} L ${padding.landscape.widthPadding}`, infoOpts);
    await builder.addTextRow(`padding source: ${padding.source}`, infoOpts);
    builder.addEmptyRow();

    if (production)
      await builder.addForwardRow('Source Code and Licenses', () => ui.loop(async loop => {
        await builder.addTitleConfigRow();
        await builder.addBackRow('Back', () => loop.return());
        await buildSourceAndLicenses(builder);
      }));
  });

  if (runAgain) {
    await ui.loop<never>(() => builder.addTextRow(`⬆ Use Close button, or tap this row to close this UITable.${saiWebViewBehind ? '\nThen, Close the "background" WebView so we can finish restarting.' : ''}`, { onSelect: () => void 0, dismissOnSelect: true }));
  }

  await ui.presentationsClosed;

  return runAgain;

  async function loadPadding() {
    const isOrientedPadding = t.isObject({ heightPadding: t.isNumber(), widthPadding: t.isNumber() });
    const isPadding = t.isObject({ portrait: isOrientedPadding, landscape: isOrientedPadding });
    const store = new Store(asidePathname(module.filename, 'json'));
    await store.read();
    if (isPadding(store.data))
      padding = { source: 'loaded previous measure', ...store.data };
    return padding;
  }
  async function savePadding() {
    const store = new Store(asidePathname(module.filename, 'json'));
    const { portrait, landscape } = padding;
    store.data = { portrait, landscape };
    await store.write();
  }
  async function measurePadding() {
    const newPadding = await measurePaddingsByGapObservation(ui);
    // // alternate method
    // const heightPadding = await measureHeightPaddingByMoire(ui);
    // const widthPaddings = await measureWidthPaddingsByMoire(ui, heightPadding);
    if (newPadding && newPadding != 'use defaults') {
      padding = { source: 'measured' as const, ...newPadding };
      await savePadding();
    }
    return newPadding && padding;
  }
  async function measurePaddingByMoire() {
    const heightPadding = await measureHeightPaddingByMoire(ui);
    if (!heightPadding) return;

    const widthPaddings = await measureWidthPaddingsByMoire(ui, heightPadding);

    return ui.loop(async loop => {
      await ui.builder.addTitleConfigRow();
      await ui.builder.addBackRow('Back', () => loop.return());
      ui.builder.addEmptyRow();
      await ui.builder.addTextRow(`Height Padding: ${heightPadding}`);
      await ui.builder.addTextRow(`Width Paddings: P ${widthPaddings.portrait} L ${widthPaddings.landscape}`);
    });
  }
}

function orientationName(screenSize: Size) {
  return screenSize.width < screenSize.height ? 'portrait' : 'landscape';
}
type PortraitAndLandscape<T> = { portrait: T, landscape: T };
function mapPnLs<T extends readonly [PortraitAndLandscape<unknown>, ...PortraitAndLandscape<unknown>[]], U>(pnlS: T, fn: (...values: DePnLTuple<T>) => U): PortraitAndLandscape<U>;
function mapPnLs<U>(pnlS: readonly PortraitAndLandscape<unknown>[], fn: (...values: unknown[]) => U): PortraitAndLandscape<U> {
  return {
    portrait: fn(...pnlS.map(pnl => pnl.portrait)),
    landscape: fn(...pnlS.map(pnl => pnl.landscape)),
  };
}
type DePnL<T> = T extends PortraitAndLandscape<infer U> ? U : never;
type DePnLTuple<T extends readonly PortraitAndLandscape<unknown>[]> =
  T extends [] ? []
  : T extends readonly [infer U, ...infer R extends PortraitAndLandscape<unknown>[]] ? readonly [DePnL<U>, ...DePnLTuple<R>]
  : T extends readonly PortraitAndLandscape<infer U>[] ? U[] // U will be a union if the types are heterogenous: sometimes "as const" will help
  : never;

type Padding = { heightPadding: number, widthPadding: number };

async function measurePaddingsByGapObservation(ui: AutoHeightUIRunner): Promise<PortraitAndLandscape<Padding> | 'use defaults' | null> {
  const builder = ui.builder;
  // in a row with 0 cellSpacing,
  // put two images next to each other; left-align the left one, right-align the right one; they will only touch if their widthWeights are "snug"
  // use some large number as the total of the widthWeights
  // give the images equal widthWeights and give the remainder of the widthWeight total to before/after padding cell(s)
  // have user do a binary^n search for the widthWeight that just lets the images touch (a "snug" widthWeight that admits no extra padding)
  //  they continually select the first row that shows a gap between the images
  // the aspect ratio of the "maximum unscaled image height" will be the widthWeightTotal/foundWidthWeight
  // do this for two different row heights (thus two different aspect ratios)
  // the two row heights and aspect ratios can be combined to compute the row height padding
  // the screen width, row height, aspect ratio, and height padding can be combined to compute the row width padding
  // do all this for both orientations

  const screenScale = Device.screenScale();

  const image = rulerImage(new Size(1, 1));

  const rowHeights = new Set([44, 105] as const);
  type RowHeights = typeof rowHeights extends Set<infer T> ? T : never;
  const widthWeightTotal = 2 ** 16; // 12 just enough on my iPhone XR
  const allState: PortraitAndLandscape<Record<RowHeights, { lowerBound: number, upperBound: number }>> = {
    portrait: {
      44: { lowerBound: 0, upperBound: widthWeightTotal },
      105: { lowerBound: 0, upperBound: widthWeightTotal },
    },
    landscape: {
      44: { lowerBound: 0, upperBound: widthWeightTotal },
      105: { lowerBound: 0, upperBound: widthWeightTotal },
    },
  };

  builder.title = 'Measure Row Padding';

  return await ui.loop(async loop => {
    const screenSize = Device.screenSize();

    // add title, and scroll padding rows
    const tp = new VariablePadding(screenSize.height * .75);
    tp.deduct(await builder.addTitleConfigRow());
    tp.deduct(await builder.addBackRow('Skip Measurement', () => loop.return('use defaults')));
    const topScrollPad = builder.addEmptyRow();

    function unfinishedStateForOrientation(o: keyof typeof allState) {
      return Array.from(rowHeights)
        .map(rh => ({ rowHeight: rh, state: allState[o][rh] }))
        .filter(s => s.state.upperBound > s.state.lowerBound + 1)
        .at(0);
    }
    const orientation = orientationName(screenSize);
    const orientedState = unfinishedStateForOrientation(orientation);

    if (!orientedState) {

      const other = orientation == 'portrait' ? 'landscape' : 'portrait';
      if (!unfinishedStateForOrientation(other)) {
        // ar = (sw-wp)/(rh-hp)             aspect ratio of maximum unscaled image size
        // wp = sw-(rh-hp)ar
        // (rh1-hp)ar1 = (rh2-hp)ar2        in the same orientation, wp are equal whatever the rh
        // hp = (rh1*ar1-rh2*ar2)/(ar1-ar2)
        const rhs = Array.from(rowHeights);
        const ars = mapPnLs([allState], s => rhs.map(rh => widthWeightTotal / s[rh].upperBound));
        const heightPadding = mapPnLs([ars],
          ars => Math.round((rhs[0] * ars[0] - rhs[1] * ars[1]) / (ars[0] - ars[1])));
        const screenWidth = orientationName(screenSize) == 'portrait'
          ? { portrait: screenSize.width, landscape: screenSize.height }
          : { portrait: screenSize.height, landscape: screenSize.width };
        const widthPadding = mapPnLs([ars, heightPadding, screenWidth],
          (ars, heightPadding, screenWidth) => Math.round(screenWidth - (rhs[0] - heightPadding) * ars[0]));
        return loop.return(mapPnLs([heightPadding, widthPadding],
          (heightPadding, widthPadding) => ({ heightPadding, widthPadding })));
      }

      await builder.addTextRow('This orientation is done, please rotate your device and continue.');

      return;
    }

    const { rowHeight, state } = orientedState;

    // add instruction row
    tp.deduct(await builder.addTextRow('Pick the first row with a gap between the squares. The gap might be quite small!'));
    tp.setOn(topScrollPad);

    // add test rows
    const steps = 16;
    const f = linear(state.lowerBound, state.upperBound, steps);
    for (let step = 1; step <= steps; step++) {
      const ww = Math.round(f(step));
      const r = builder.addEmptyRow();
      r.height = rowHeight;
      r.cellSpacing = 0;
      r.dismissOnSelect = false;
      r.onSelect = () => {
        state.lowerBound = Math.round(f(step - 1));
        state.upperBound = ww;
        loop.again();
      };
      const remaining = widthWeightTotal - 2 * ww;
      const left = Math.floor(remaining / 2);
      const right = remaining - left;
      if (left > 0)
        r.addText('').widthWeight = left;
      addImage(r, image, ic => { ic.widthWeight = ww; ic.leftAligned() });
      addImage(r, image, ic => { ic.widthWeight = ww; ic.rightAligned() });
      if (right > 0)
        r.addText('').widthWeight = right;
    }

    // alternate design: each row has only one image, right-align it
    // pick first row that is "indented" any amount (even a tiny amount; probably need to use zoom)

    // add scroll padding, and informational rows
    const bp = new VariablePadding(screenSize.height * .75);
    const bottomScrollPad = builder.addEmptyRow();
    bp.deduct(await builder.addTextRow(`device scale: ${screenScale}×`));
    bp.deduct(await builder.addTextRow(`device W×H: ${screenSize.width}×${screenSize.height} pt`));
    bp.deduct(await builder.addTextRow(`row cell weighting total: ${widthWeightTotal}`));
    bp.deduct(await builder.addTextRow(`row height: ${rowHeight}`));
    bp.deduct(await builder.addTextRow(`${state.lowerBound} <= cell weight < ${state.upperBound}`));
    bp.deduct(await builder.addTextRow(`${(widthWeightTotal / state.upperBound).toFixed(6)} < ar <= ${(widthWeightTotal / state.lowerBound).toFixed(6)}`));
    bp.setOn(bottomScrollPad);
  });
}
function addImage(row: UITableRow, image: Image, fn: (imageCell: UITableCell) => void) {
  fn(row.addImage(image));
}
function linear(zero: number, one: number, denominator: number): (numerator: number) => number {
  return numerator => {
    const fraction = numerator / denominator;
    if (0 <= fraction && fraction <= 1)
      return zero * (1 - fraction) + one * fraction;
    else
      throw new RangeError(`linear interpolation: ${numerator}/${denominator} not between 0 and 1 (both inclusive)`);
  };
}
class VariablePadding {
  constructor(private targetHeight: number) { }
  deduct<R extends { get height(): number }>(r: R): R {
    this.targetHeight -= r.height;
    return r;
  }
  setOn<R extends { set height(height: number) }>(r: R): R {
    r.height = Math.max(0, Math.round(this.targetHeight));
    return r;
  }
}

// spell-checker:word moiré
async function measureHeightPaddingByMoire(ui: AutoHeightUIRunner) {
  // display an moire "screened" image of consistent height in rows of varying
  // heights; visually identify non-scaled row by moire pattern quality; this
  // may be hard to do without already having experience with what to look for:
  // a "clean", consistent moire pattern that isn't blurred, faded, or "broken
  // up"

  const builder = ui.builder;
  const screenScale = Device.screenScale();

  const imageHeight = 100;
  const min = 100;
  const tooMuch = min + 32; // XXX what if padding is actually more?

  return await ui.loop<number | undefined>(async loop => {
    const screenSize = Device.screenSize();
    const orientation = orientationName(screenSize);
    const portraitWidth = orientation == 'portrait' ? screenSize.width : screenSize.height;


    if (orientation == 'landscape') {
      // portrait only; this should work in landscape, but row height padding
      // doesn't seem to vary between portrait and landscape (which is
      // reasonable since the table scrolls vertically: the row heights are not
      // really related to device height); so, letting the user iterate on both
      // is probably just wasted effort; also we can reasonably use portrait's
      // image width (lower bound) that we derive here as a lower bound for
      // landscape's image width to speed up landscape width measuring a bit
      await builder.addTextRow('This part of the row measurement only works in portrait mode. Please turn your device so the longest edges are "up and down".');
      return;
    }

    // add title, and scroll padding rows
    const tp = new VariablePadding(screenSize.height * .75);
    tp.deduct(await builder.addTitleConfigRow());
    tp.deduct(await builder.addBackRow('Skip Measurement', () => loop.return(void 0)));
    const topScrollPad = builder.addEmptyRow();

    // add instruction row
    tp.deduct(await builder.addTextRow('Pick the row, with the most consistent and least blurred moiré pattern.'));
    tp.setOn(topScrollPad);

    // add test rows
    for (let h = min; h < tooMuch; h++)
      addRulerRow(builder.table, h, new Size(Math.trunc(portraitWidth / 2), imageHeight), (size, rowHeight) => loop.return(rowHeight - size.height));

    // add scroll padding, and informational rows
    const bp = new VariablePadding(screenSize.height * .75);
    const bottomScrollPad = builder.addEmptyRow();
    bp.deduct(await builder.addTextRow(`device scale: ${screenScale}×`));
    bp.deduct(await builder.addTextRow(`device W×H: ${screenSize.width}×${screenSize.height} pt`));
    bp.deduct(await builder.addTextRow(`ih: ${imageHeight}: ${min} <= rh < ${tooMuch}`));
    bp.setOn(bottomScrollPad);
  });
}

async function measureWidthPaddingsByMoire(ui: AutoHeightUIRunner, heightPadding: number, portraitImageWidthBounds?: [number, number]): Promise<PortraitAndLandscape<number | null>> {
  const builder = ui.builder;
  builder.title = 'Measuring Width Padding';

  const screenScale = Device.screenScale();

  type State = { screenSize: Size, width: number, tooWide: number, done: boolean };
  const orientationState: PortraitAndLandscape<State | null> = {
    portrait: null,
    landscape: null
  };

  const rowHeight = 105;
  const imageHeight = rowHeight - heightPadding;

  await ui.loop(async loop => {
    const screenSize = Device.screenSize();

    const state = ((orientation: keyof typeof orientationState) => {
      const state = orientationState[orientation];
      if (state != null) return state;

      return orientationState[orientation] = {
        screenSize,
        width: portraitImageWidthBounds?.[0] ?? 1,
        tooWide: (orientation == 'portrait' ? portraitImageWidthBounds?.[1] : null) ?? screenSize.width + 1,
        done: false,
      };
    })(orientationName(screenSize));

    const increment = incrementFor(state);

    builder.rowWidth = state.width >= 100 ? state.width : null;

    // add title, and scroll padding rows
    const tp = new VariablePadding(screenSize.height * .75);
    tp.deduct(await builder.addTitleConfigRow());
    tp.deduct(await builder.addBackRow('Skip Measurement', () => loop.return()));
    const topScrollPad = builder.addEmptyRow();

    if (state.done)
      await builder.addTextRow('Row measurement for this orientation is done. Please rotate your device and continue.');
    else {
      tp.deduct(await builder.addTextRow('Pick the lowest row that shows the consistent, un-blurred moiré pattern that matches the pattern shown in the first row).'));
      tp.setOn(topScrollPad);

      // add test rows
      for (let imageWidth = state.width; imageWidth < state.tooWide; imageWidth += increment)
        addRulerRow(builder.table, rowHeight, new Size(imageWidth, imageHeight), size => {
          state.width = size.width;
          state.tooWide = Math.min(state.tooWide, state.width + increment);
          if (incrementFor(state) < 1)
            state.done = true;
          const allDone = orientationState.portrait?.done && orientationState.landscape?.done;
          if (allDone)
            loop.return();
          else
            loop.again();
        });

      // add scroll padding, and informational rows
      const bp = new VariablePadding(screenSize.height * .75);
      const bottomScrollPad = builder.addEmptyRow();
      bp.deduct(await builder.addTextRow(`device scale: ${screenScale}×`));
      bp.deduct(await builder.addTextRow(`device W×H: ${screenSize.width}×${screenSize.height} pt`));
      bp.deduct(await builder.addTextRow(`current: by ${increment}, ${state.width} <= image width < ${state.tooWide}`));
      bp.setOn(bottomScrollPad);
    }

    function incrementFor(state: State) {
      return powerOf(10, state.tooWide, state.width);
    }
  });

  return {
    portrait: widthPaddingIn('portrait'),
    landscape: widthPaddingIn('landscape'),
  };

  function widthPaddingIn(pl: keyof typeof orientationState) {
    const state = orientationState[pl];
    if (!state?.done)
      return null;
    return state.screenSize.width - state.width;
  }
}
function powerOf(factor: number, tooMuch: number, start: number) {
  if (!(start < tooMuch)) throw new RangeError(`backward range: expected start (${start}) < (${tooMuch}) tooMuch`);

  let increment = factor ** Math.trunc(Math.log(tooMuch - 1) / Math.log(factor));

  while (start + increment >= tooMuch)
    increment = Math.round(increment / factor);

  return increment;
}

function addRulerRow(t: UITable, rowHeight: number, imageSize: Size, pick?: (size: Size, rowHeight: number) => void) {
  const r = new UITableRow;
  r.height = rowHeight;
  r.cellSpacing = 0;
  const image = rulerImage(imageSize);
  const i = r.addImage(image);
  i.widthWeight = 10;
  r.dismissOnSelect = false;
  r.onSelect = async () => {
    const a = new Alert;
    a.title = `${imageSize.width}x${imageSize.height}`;
    a.message = `${imageSize.width}x${imageSize.height} image in ${r.height} high row`;
    if (pick)
      a.addAction('Use It');
    a.addCancelAction('Cancel');
    if (await a.present() == -1) return;
    pick?.(imageSize, rowHeight);
  };
  t.addRow(r);
  return r;
}

async function measureFonts(ui: AutoHeightUIRunner) {
  const builder = ui.builder;

  type Measures = FontMeasures & {
    diacriticHeight: number,
    diacriticLineCount: number,
  };
  const measures = new Map<number, Measures>;

  await ui.loop(async (loop, { fontMeasures }) => {
    {
      const { enWidth, lineSpacing } = fontMeasures;
      if (!measures.has(enWidth)) {
        const { lineCount: diacriticLineCount, height: diacriticHeight } =
          await measureLinesWithDiacritics(ui.fontMeasurer, enWidth, lineSpacing);
        measures.set(enWidth, { ...fontMeasures, diacriticHeight, diacriticLineCount });
        return loop.again();
      }
    }

    await builder.addTitleConfigRow();
    await builder.addSubtitleHelpRow('Measure Fonts');
    await builder.addBackRow('Back', () => loop.return());
    builder.addEmptyRow();

    await builder.addTextRow('Switch to a new text size in Display or Accessibility settings, the new setting will be automatically measured (watch for a change in "Gathered sizes").\n\nWhen you are done, tap "Copy Measurements to Clipboard" and/or "Back".');
    builder.addEmptyRow();
    if (measures.size > 0)
      await builder.addTextRow(`Gathered sizes: ${Array.from(measures.keys()).sort((a, b) => a - b).join(', ')}`);
    await builder.addTextRow('Copy Measurements to Clipboard', {
      onSelect: async () => {
        const keys: (keyof Measures)[] = ['enWidth', 'enDashHeight', 'spaceWidth', 'averageDigitWidth', 'averageLowercaseWidth', 'averageUppercaseWidth', 'lineSpacing', 'diacriticHeight', 'diacriticLineCount'];
        const sep = ',';
        const header = keys.join(sep);
        const rows = Array.from(measures.values()).sort((a, b) => a.enWidth - b.enWidth).map(m => keys.map(k => m[k]).join(sep));
        const data = [header, ...rows].join('\n');
        Pasteboard.copyString(data);
        const csvFile = await localTempfile('font-sizes.csv', data);
        await QuickLook.present(csvFile.pathname);
        await csvFile.remove();
      }
    });
  });
}
// check line spacing when first/last has above/below diacritics
async function measureLinesWithDiacritics(fontMeasurer: FontMeasurer, enWidth: number, lineSpacing: number) {
  const above = [
    0x0300, 0x0301, 0x0302, 0x0303, 0x0304, 0x0306, 0x0307,
    0x0308, 0x0309, 0x030a, 0x030b, 0x030c, 0x030d, 0x0311,
    0x0312, 0x0313, 0x0314, 0x0315, 0x033e, 0x0341, 0x0357,
  ].map(cc => 'A' + String.fromCodePoint(cc)).join('');
  const below = [
    0x0323, 0x0324, 0x0325, 0x0326, 0x0327, 0x0328,
    0x0329, 0x032e, 0x032f, 0x0330, 0x0331,
  ].map(cc => 'A' + String.fromCodePoint(cc)).join('');
  const str = `X${above}I͝JK͡L\nX\n${below}gjpqyp͜qɳᶇX`; // spell-checker:ignoreRegExp X\S*X
  const renderHeight = (await fontMeasurer.measureString_(str, enWidth * 1.25 /* these chars wider than one en */, lineSpacing)).height;
  const lines = Array.from(str.matchAll(/\n/g)).length + 1;
  return { lineCount: lines, height: renderHeight };
}

async function showLineBreaks(ui: AutoHeightUIRunner) {
  const builder = ui.builder;
  return await ui.loop(async loop => {
    await builder.addTitleConfigRow();
    await builder.addSubtitleHelpRow('Show/Measure Line Breaks');
    await builder.addBackRow('Back', () => loop.return());
    builder.addEmptyRow();
    // XXX Passages?
    await builder.addForwardRow('Artificial Examples', () => artificialExamples(ui));
    await builder.addForwardRow('Simple Numbered Lines', () => simpleNumberedLines(ui));
  });
}
async function artificialExamples(ui: AutoHeightUIRunner) {
  const builder = ui.builder;

  type State = (string | { text: string, widthWeight: number, align: 'left' | 'center' | 'right' }[])[];
  const state: State = [
    'This is a short line.',
    'This is a longer line. It will break onto a second line, but the location depends on the font.',
    'ThisIsAnOverlongLineThatHasNoPlaceToBreakButItWillBeBrokenIfThereIsEnoughHeightForAnotherLine',
    'This is a long line. With Default text size and 374 point row width, it will break to a new line. Even more lines happens if the row is tall enough.',
    'Here is another kind of test?ItWillHaveLongLinesAndAlsoOverfillingSectionsOfTextThatWillNeedToBeForciblyBrokenWithoutANormalBreakCharacter\n\nIt\nalso has forced line breaks in here since those need to be handled specially. EventuallyThereWillBeAnotherReallyStrangeLineThatCanNotBeBrokenAnywhereAndWillOverfillALineAndBeForciblyBroken. Then we will have\n some more regular text.\nEND',
    [
      {
        text: 'This is some text that will go in one half-width "column". It will be displayed alongside another text cell that has the same widthWeight.',
        widthWeight: 2,
        align: 'left',
      },
      {
        text: 'ThisIsTheOther"Column"ItHasAReallyLongStartThatWillNeedToBeForciblyBrokenIntoLines, but then it has more typical words that offer many places to introduce line breaks.',
        widthWeight: 2,
        align: 'right',
      },
    ],

    // break after
    //  space ! - / ? | }
    // non breaking
    //  " # $ % ' ( ) * + , . : ; < = > @ [ \ ] ^ _ ` { ~ letters digits
    ...(new Array(127 - 32)).fill(32).map((...[, i]) => String.fromCodePoint(i + 32)).map(s => '_'.repeat(20) + s + '_'.repeat(20)),
  ];

  let autoHeight = true;
  let font: NamedFont = 'body';

  await ui.loop(async loop => {
    await builder.addTitleConfigRow();
    await builder.addSubtitleHelpRow('Artificial Examples');
    await builder.addBackRow('Back', () => loop.return());
    builder.addEmptyRow();

    await builder.addCheckableRow('Auto-height', autoHeight, () => {
      autoHeight = !autoHeight;
      loop.again();
    });
    await builder.addForwardRow('Font: ' + font, async () => {
      const newFont = await pickFont(ui, font);
      if (newFont === null) return loop.return();
      font = newFont;
    });
    builder.addEmptyRow();

    const i = builder.inspections;
    builder.inspections = true;
    await state.reduce(async (p, row) => {
      await p;
      const r = await (() => {
        if (typeof row == 'string') {
          return builder.addTextRow({ title: row, titleFont: font });
        } else {
          return builder.adderForTableRow(row)(row.map(r => ({ title: r.text, titleFont: font })), { cellSpacing: 0 });
        }
      })();
      if (!autoHeight) r.height = 44;
    }, Promise.resolve());
    builder.inspections = i;

    await builder.addBackRow('Back', () => loop.return());
  });
}
async function simpleNumberedLines(ui: AutoHeightUIRunner) {
  const builder = ui.builder;
  let font: NamedFont = 'body';
  return await ui.loop(async loop => {
    await builder.addTitleConfigRow();
    await builder.addSubtitleHelpRow('Simple Numbered Lines', 'You can use this screen to verify that extremely simple multi-line text rows correctly adapt their heights for different text sizes.');
    await builder.addBackRow('Back', () => loop.return());
    builder.addEmptyRow();
    await builder.addForwardRow('Font: ' + font, async () => {
      const newFont = await pickFont(ui, font);
      if (newFont === null) return loop.return();
      font = newFont;
    });
    builder.addEmptyRow();
    for (let i = 0; i < 30; i++)
      await builder.addTextRow({ title: numberedLines(i + 1), titleFont: font });
    builder.addEmptyRow();
    await builder.addBackRow('Back', () => loop.return());
  });
}
function numberedLines(n: number) {
  return new Array(n).fill(0).map((...[, i]) => i + 1).join('\n');
}
async function measureHeights(ui: AutoHeightUIRunner) {
  const builder = ui.builder;

  let font: NamedFont = 'body';
  let startingLineCount = 2;

  for (; ;) {
    const startAction = await ui.loop<'start' | 'back'>(async loop => {
      await builder.addTitleConfigRow();
      await builder.addSubtitleHelpRow('Measure Row Height for N Lines', 'This part of the program lets you measure the exact row height needed to display a number of lines of text.');
      await builder.addBackRow('Back', () => loop.return('back'));
      builder.addEmptyRow();
      await builder.addForwardRow('Font: ' + font, async () => {
        const newFont = await pickFont(ui, font);
        if (newFont === null) return loop.return('back');
        font = newFont;
      });
      await builder.addForwardRow('Initial Line Count: ' + startingLineCount, async () => {
        const a = new Alert;
        a.title = 'Starting Number of Lines';
        a.message = 'How many lines do you want to start with?\nMust be 2 or more.';
        const t = a.addTextField('number of lines', String(startingLineCount));
        t.setNumberPadKeyboard();
        a.addCancelAction('Cancel');
        a.addAction('Choose');
        if (await a.present() == -1) return 0;
        const lineCount = parseInt(a.textFieldValue(0));
        if (lineCount < 2 || isNaN(lineCount)) return;
        startingLineCount = lineCount;
        loop.again();
      });
      builder.addEmptyRow();
      await builder.addForwardRow('Start Measuring', () => loop.return('start'));
    });

    if (!startAction || startAction == 'back') return;

    const bodyFm = await ui.fontMeasurer.measureFont();
    const pickedFm = await ui.fontMeasurer.measureFont(Font[font]());
    let prev = heightFor(startingLineCount - 2, bodyFm, pickedFm);
    let current = heightFor(startingLineCount, bodyFm, pickedFm);
    let notEnough = prev;
    let enough: number | undefined;

    let lastPicked = 0;
    const ignoreIfTooSoon = (fn: () => void) => () => Date.now() - lastPicked >= 500 && fn();

    let lineCount = startingLineCount;

    const nextColor = (() => {
      const colors = [Color.lightGray(), Color.darkGray()];
      let colorIndex = 0;
      return () => colors[colorIndex = (colorIndex + 1) % colors.length];
    })();

    const measureAction = await ui.loop<'quit' | 'restart'>(async (loop, { fontMeasures: newFm }) => {

      await builder.addTitleConfigRow();
      await builder.addSubtitleHelpRow('Measure Row Height for N Lines', 'This part of the program lets you measure the exact row height needed to display a number of lines of text (in the current font).');
      await builder.addBackRow('Quit Measuring', () => loop.return('quit'));
      builder.addEmptyRow();

      if (newFm.enWidth != bodyFm.enWidth || newFm.lineSpacing != bodyFm.lineSpacing)
        await builder.addTextRow('Font size must not be changed while measuring row height for number of lines.\nPlease return to the original font size, or Restart.');
      else if (!enough || enough - notEnough > 1) {
        await builder.addTextRow(`Finding row height for ${lineCount} lines…\nScroll to the bottom and answer the question.`);

        (await builder.addTextRow({ title: numberedLines(lineCount + 1), titleFont: font })) // normal lowercase descenders didn't change these measurements
          .height = current;

        {
          // builder doesn't have a "text with buttons" row adder, so do it "manually"
          const questionRow = new UITableRow;
          questionRow.backgroundColor = nextColor();
          const [noWidth, questionWidth, yesWidth] =
            apportionWidth([{ widthWeight: 15 }, { widthWeight: 70 }, { widthWeight: 15 }], builder.rowWidth, questionRow.cellSpacing)
              .map(aw => aw.width);

          const no = questionRow.addButton('No');
          no.leftAligned();
          no.onTap = () => {
            notEnough = current;
            current = enough == null ? current + pickedFm.lineSpacing : Math.round((current + enough) / 2);
            lastPicked = Date.now();
            loop.again();
          };
          no.widthWeight = noWidth;

          const questionText = `See ${lineCount}?`;
          questionRow.height = estimatedHeightOf(questionText, bodyFm, bodyFm, questionWidth); // could also max with est height of buttons, too; but what is their default font? it is usually smaller than body. also it seems like it doesn't scale with Dynamic Text size?
          const question = questionRow.addText(questionText);
          question.centerAligned();
          question.widthWeight = questionWidth;

          const yes = questionRow.addButton('Yes');
          yes.rightAligned();
          yes.widthWeight = yesWidth;
          yes.onTap = () => {
            enough = current;
            current = Math.round((notEnough + current) / 2);
            lastPicked = Date.now();
            loop.again();
          };

          builder.table.addRow(questionRow);
        }
        builder.addEmptyRow();
        await builder.addTextRow(`${notEnough} < ${current}${enough != null ? ` <= ${enough}` : ''}`);
      } else {
        await builder.addTextRow(`Measured ${font} font with\n${pickedFm.lineSpacing} line spacing,\n${pickedFm.enWidth} en width.\n\n${lineCount} lines fits in\n${current} row height`);
        await builder.addForwardRow(`Measure ${lineCount + 1} lines`, ignoreIfTooSoon(() => {
          const diff = current - prev;
          prev = current;
          // current = heightFor(++lineCount, pickedFm);
          lineCount++;
          current += diff;

          notEnough = prev;
          enough = void 0;
          loop.again();
        }));
        builder.addEmptyRow();
        await builder.addForwardRow(`Redo ${lineCount} lines`, ignoreIfTooSoon(() => {
          current = heightFor(lineCount, bodyFm, pickedFm);
          notEnough = prev;
          enough = void 0;
          loop.again();
        }));
      }
      builder.addEmptyRow().height = 88;
      await builder.addBackRow('Restart (for different font or size)', ignoreIfTooSoon(() => loop.return('restart')));
    });

    if (!measureAction || measureAction == 'quit') return;
  }
}
function pickFont(ui: AutoHeightUIRunner, currentFont: NamedFont) {
  const builder = ui.builder;
  return ui.loop<NamedFont>(async loop => {
    await builder.addTitleConfigRow();
    await builder.addSubtitleHelpRow('Pick a "Named" Font', 'These are the predefined fonts that Scriptable provides. They automatically adjust their sizes based on the text size configured in iOS Settings.');
    await builder.addBackRow('Back', () => loop.return(currentFont));
    builder.addEmptyRow();
    await Array.from(fontNames).reduce(async (p, f) => {
      await p;
      await builder.addIndentRow({ title: String(f), titleFont: f, ...f == currentFont ? { titleColor: Color.orange() } : {} }, { onSelect: () => loop.return(f) });
    }, Promise.resolve());
  });
}

async function showSafeAreaInsets(ui: AutoHeightUIRunner) {
  const builder = ui.builder;
  await ui.loop(async (loop, { safeAreaInsets }) => {
    await builder.addTitleConfigRow();
    await builder.addSubtitleHelpRow('Safe Area Insets', 'This part of the program reports the horizontal (left/right) safe area insets available in a WebView. iOS provides these insets so that "full screen" web pages can avoid placing elements that might end up under the notch/island on certain devices. This should give us a numbers that can be used to reconstruct a UITableRow\'s "width padding" without needing to measure it.');
    await builder.addBackRow('Back', () => loop.return());
    builder.addEmptyRow();
    await builder.addTextRow(JSON.stringify(safeAreaInsets), { onSelect: () => loop.again() });
    await builder.addTextRow(JSON.stringify(await ui.safeAreaInsetsFetcher.getLeftAndRight()), { onSelect: () => loop.again() });
  });
}

await main();
