import production from 'consts:production';
import { AutoWidthUIRunner, estimatedHeightOf, heightFor, type FontMeasurer, type FontMeasures, type LoopControl } from 'uitable-runner';
import { buildSourceAndLicenses } from './build-source-and-licenses.js';
import { apportionWidth } from './lib/row-width.js';
import { rulerImage } from './lib/ruler-image.js';
import { localTempfile } from './lib/scriptable-utils.js';
import { getOrSetNew } from './lib/ts-utils.js';
import { UITableBuilder, fontNames, textCell, type NamedFont } from './lib/uitable-builder.js';

type UIRunner = AutoWidthUIRunner<UITableBuilder>;

async function main() {
  for (let saiWebViewBehind = Device.isPad(); ; saiWebViewBehind = !saiWebViewBehind) // multitasking on iPad needs width report that is only accurate when presented...
    if (!await main2(saiWebViewBehind)) return;
}

async function main2(saiWebViewBehind: boolean) {

  const ui = await AutoWidthUIRunner.start((t, fm) => UITableBuilder.create(t, fm), { visibleSafeAreaInsetWebView: saiWebViewBehind });
  const builder = ui.builder;

  let n = 0; // debug counter
  const runAgain = await ui.loop<true>(async loop => {
    builder.title = 'Automatic Row Height Demonstrations ' + n++;

    await builder.addTitleConfigRow();
    builder.addEmptyRow();

    await builder.addForwardRow('Show Line Breaks', () => showLineBreaks(ui));
    // XXX show comparisons: native text block vs. "our" breaking (and rendering?)
    builder.addEmptyRow();

    await builder.addForwardRow('Check Row Paddings', () => checkPaddingsByGapObservation(ui));
    await builder.addForwardRow('Show Safe Area Insets', () => showSafeAreaInsets(ui));
    await builder.addForwardRow('Show Zero widthWeights', () => showWidthWeights(ui));
    await builder.addForwardRow('Measure Row Height for N Lines', () => measureHeights(ui));
    await builder.addForwardRow('Measure Fonts', () => measureFonts(ui));
    builder.addEmptyRow();

    await builder.addForwardRow('Check Row Paddings By Moiré', () => checkPaddingByMoire());
    await builder.addIndentRow(textCell('This technique is probably more difficult to use than the default "gap" technique. The first step requires subtle discernment that may not be obvious unless you already know what to look for.', { titleFont: 'footnote' }));
    builder.addEmptyRow();

    // XXX move these to config? anything else? "extra lines" config?
    await builder.addCheckableRow('Derive "base padding" from screen width?', ui.paddingBasedOnScreenSize, () => {
      ui.paddingBasedOnScreenSize = !ui.paddingBasedOnScreenSize;
      loop.again();
    });

    await builder.addIndentRow(textCell(ui.paddingBasedOnScreenSize
      ? `Will use screen width.`
      : `Will use multitasking "window" width.\nThis is only meaningful on devices that can "multitask" (Split View, Slide Over, Stage Manager).`,
      { titleFont: 'footnote' }));
    await builder.addForwardRow('Toggle "Visibility" of Safe Area Inset WebView', () => loop.return(true));
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

  async function checkPaddingByMoire() {
    const heightPadding = await measureHeightPaddingByMoire(ui);
    if (!heightPadding) return;
    await checkWidthPaddingsByMoire(ui, heightPadding);
  }
}

type Padding = { heightPadding: number, widthPadding: number };

type SizeKey = {
  screenSize: { width: number, height: number },
  windowSize: { width: number, height: number },
  safeAreaInsets: { left: number, right: number },
  contentWidth: number, // not part of key lookup; included so summary can check runner's provided content width against measured width padding
}
async function multiSize<SizeState>(ui: UIRunner, makeNewState: (key: SizeKey) => SizeState, runOne: (loop: LoopControl<void>, key: SizeKey, state: SizeState, addStatusRows: (paddings: Map<SizeKey, Padding>) => Promise<void>) => Promise<void>): Promise<void | null> {
  const builder = ui.builder;

  const stateKeys = new Map<number, Map<number, Map<number, Map<number, Map<number, Map<number, SizeKey>>>>>>;
  function getStateKey(screenSize: Size, windowSize: Size, safeAreaInsets: { left: number, right: number }, contentWidth: number) {
    const sh = getOrSetNew(stateKeys, screenSize.width, () => new Map);
    const ww = getOrSetNew(sh, screenSize.height, () => new Map);
    const wh = getOrSetNew(ww, windowSize.width, () => new Map);
    const li = getOrSetNew(wh, windowSize.height, () => new Map);
    const ri = getOrSetNew(li, safeAreaInsets.left, () => new Map);
    const key = getOrSetNew(ri, safeAreaInsets.right, () => ({
      screenSize,
      windowSize,
      safeAreaInsets,
      contentWidth,
    }));
    return key;
  }
  const allStates = new Map<SizeKey, SizeState>;

  return await ui.loop(async (loop, { windowSize, safeAreaInsets }) => {
    const key = getStateKey(Device.screenSize(), windowSize, safeAreaInsets, builder.rowWidth);
    const state = getOrSetNew(allStates, key, () => makeNewState(key));
    await runOne(loop, key, state, paddings => addStatusRows(key, paddings));
  });

  async function addStatusRows(currentKey: SizeKey, paddings: Map<SizeKey, Padding>) {
    const sortedKeys = Array.from(allStates.keys()).sort((a, b) => [
      a.screenSize.width - b.screenSize.width,
      a.windowSize.width - b.windowSize.width,
      a.safeAreaInsets.left - b.safeAreaInsets.left,
      a.safeAreaInsets.right - b.safeAreaInsets.right,
      a.screenSize.height - b.screenSize.height,
    ].reduce((ret, comparison) => ret != 0 ? ret : comparison));

    const info = ['screen width,screen height,window width,window height,left inset,right inset,row width padding,row height padding'];
    await builder.addForwardRow('View or Copy Padding Info', async () => {
      const text = info.join('\n');
      const a = new Alert;
      a.title = 'Size/Inset/Padding Info';
      a.message = text;
      a.addAction('Copy');
      a.addCancelAction('Cancel');
      const ac = await a.present();
      if (ac == -1) return;
      Pasteboard.copyString(text);
    });

    for (const key of sortedKeys) {
      const { screenSize, windowSize, safeAreaInsets } = key;
      const name = orientationAndMultitaskingName(screenSize, windowSize);

      const text = `${name?.concat('\n') ?? ''}screen size ${sz(screenSize)} window size ${sz(windowSize)}\nleft/right insets ${safeAreaInsets.left}/${safeAreaInsets.right}`;
      const backgroundColor = key == currentKey ? Color.gray() : void 0;

      const padding = paddings.get(key);
      if (padding) {
        info.push(`${screenSize.width},${screenSize.height},${windowSize.width},${windowSize.height},${safeAreaInsets.left},${safeAreaInsets.right},${padding.widthPadding},${padding.heightPadding}`);
        const hOk = padding.heightPadding == 16;
        const wOk = windowSize.width - padding.widthPadding == key.contentWidth;
        await builder.addTextRow(`${text}\nwidth padding ${mark(wOk)} ${padding.widthPadding}, height padding ${mark(hOk)} ${padding.heightPadding}`, { backgroundColor });
      } else
        await builder.addTextRow(`${text}: incomplete`, { backgroundColor });
    }
    function orientationAndMultitaskingName(screenSize: Size, windowSize: Size) {
      const orientation = screenSize.width < screenSize.height ? 'portrait' : 'landscape';
      if (windowSize.height == screenSize.height) {
        if (windowSize.width == screenSize.width)
          return 'full-screen ' + orientation;
        else if (validSplit(1 / 2, screenSize.width, windowSize.width))
          return '1/2 ' + orientation;
        else if (validSplit(1 / 3, screenSize.width, windowSize.width))
          return '1/3 ' + orientation;
        else if (validSplit(2 / 3, screenSize.width, windowSize.width))
          return '2/3 ' + orientation;
        // XXX I don't think 1/4 and 3/4 are actually possible, but some places mention 25% and 75% (HIG says 1/3 and 2/3...)
        else if (validSplit(1 / 4, screenSize.width, windowSize.width))
          return '1/4 ' + orientation;
        else if (validSplit(3 / 4, screenSize.width, windowSize.width))
          return '3/4 ' + orientation;
      }
      // XXX slide over is probably not full height and a bit less than 1/3 width
      return sz(windowSize) + ' in ' + orientation;
    }
    function sz(size: { width: number, height: number }) {
      return `${size.width}×${size.height}`;
    }
    function validSplit(fraction: number, screenWidth: number, windowWidth: number) {
      // XXX only one of these is correct; probably "a"? but unless we actually measure the divider handle width we are only guessing
      const a = screenWidth - windowWidth / fraction; // subtract space for divider, then split
      const b = screenWidth * fraction - windowWidth; // split, then subtract space for divider
      const dividerSizeGuess = 20;
      return a >= 0 && a <= dividerSizeGuess
        || b >= 0 && b <= dividerSizeGuess;
    }
    function mark(ok: boolean) {
      return ok ? '✔' : '✘';
    }
  }
}

async function checkPaddingsByGapObservation(ui: UIRunner): Promise<void | null> {
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
  // the window width, row height, aspect ratio, and height padding can be combined to compute the row width padding
  // do all this for each orientation or multitasking window size the user arranges

  const image = rulerImage(new Size(1, 1));

  const rowHeights = new Set([44, 105] as const);
  type RowHeights = typeof rowHeights extends Set<infer T> ? T : never;
  const widthWeightTotal = 2 ** 16; // 12 just enough on my iPhone XR

  type State = Record<RowHeights, { lowerBound: number, upperBound: number }>;
  const paddings = new Map<SizeKey, Padding>;

  builder.title = 'Check Row Paddings';

  return multiSize(ui, (): State => ({
    44: { lowerBound: 0, upperBound: widthWeightTotal },
    105: { lowerBound: 0, upperBound: widthWeightTotal },
  }), async (loop, key, bothHeightsState, addStatusRows) => {

    // add title, and scroll padding rows
    const tp = new VariablePadding(key.windowSize.height * .75);
    tp.deduct(await builder.addTitleConfigRow());
    tp.deduct(await builder.addBackRow('Back', () => loop.return()));
    const topScrollPad = builder.addEmptyRow();

    function unfinishedRowHeight(state: State) {
      return Array.from(rowHeights)
        .map(rh => ({ rowHeight: rh, state: state[rh] }))
        .filter(s => s.state && s.state.upperBound > s.state.lowerBound + 1)
        .at(0);
    }
    const unfinished = unfinishedRowHeight(bothHeightsState);

    if (!unfinished) {

      if (!paddings.has(key)) {
        const padding = paddingForState(key, bothHeightsState);
        if (padding) paddings.set(key, padding);
      }

      await builder.addTextRow('You have completed the padding check for this size and orientation. To check another configuration, activate another multitasking size and/or rotate your device into a different orientation.');
      await builder.addIndentRow(textCell('Multitasking is available on iPads through Split View, Slide Over, and (if the iPad supports it) Stage Manager.', { titleFont: 'footnote' }));
      builder.addEmptyRow();

      await addStatusRows(paddings);

      return;
    }

    const { rowHeight, state } = unfinished;

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
    const bp = new VariablePadding(key.windowSize.height * .75);
    const bottomScrollPad = builder.addEmptyRow();
    bp.deduct(await builder.addTextRow(`row cell weighting total: ${widthWeightTotal}\nrow height: ${rowHeight}\n${state.lowerBound} <= cell weight < ${state.upperBound}\n${(widthWeightTotal / state.upperBound).toFixed(6)} < ar <= ${(widthWeightTotal / state.lowerBound).toFixed(6)}`));
    bp.setOn(bottomScrollPad);
    builder.addEmptyRow();

    await addStatusRows(paddings);
  });

  function paddingForState(key: SizeKey, state: State) {
    // ar = (ww-wp)/(rh-hp)             aspect ratio of unscaled image size
    // wp = ww-(rh-hp)ar
    // (rh1-hp)ar1 = (rh2-hp)ar2        in the same orientation, wp should be the same for all rh
    // hp = (rh1*ar1-rh2*ar2)/(ar1-ar2)
    const rhs = Array.from(rowHeights);
    const ars = rhs.map(rh => widthWeightTotal / state[rh].upperBound);
    const heightPadding = Math.round((rhs[0] * ars[0] - rhs[1] * ars[1]) / (ars[0] - ars[1]));
    const windowWidth = key.windowSize.width;
    const widthPadding = Math.round(windowWidth - (rhs[0] - heightPadding) * ars[0]);
    return { heightPadding, widthPadding };
  }
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
async function measureHeightPaddingByMoire(ui: UIRunner) {
  // display an moire "screened" image of consistent height in rows of varying
  // heights; visually identify non-scaled row by moire pattern quality; this
  // may be hard to do without already having experience with what to look for:
  // a "clean", consistent moire pattern that isn't blurred, faded, or "broken
  // up"

  const builder = ui.builder;

  const imageHeight = 100;
  const min = 100;
  const tooMuch = min + 32; // XXX what if padding is actually more?

  return await ui.loop<number | undefined>(async (loop, { windowSize }) => {

    // add title, and scroll padding rows
    const tp = new VariablePadding(windowSize.height * .75);
    tp.deduct(await builder.addTitleConfigRow());
    tp.deduct(await builder.addBackRow('Skip Measurement', () => loop.return(void 0)));
    const topScrollPad = builder.addEmptyRow();

    // add instruction row
    tp.deduct(await builder.addTextRow('Pick the row, with the most consistent and least blurred moiré pattern.'));
    tp.setOn(topScrollPad);

    // add test rows
    for (let h = min; h < tooMuch; h++)
      addRulerRow(builder.table, h, new Size(Math.trunc(windowSize.width / 2), imageHeight), (size, rowHeight) => loop.return(rowHeight - size.height));

    // add scroll padding, and informational rows
    const bp = new VariablePadding(windowSize.height * .75);
    const bottomScrollPad = builder.addEmptyRow();
    bp.deduct(await builder.addTextRow(`image height: ${imageHeight}\n${min} <= row height < ${tooMuch}`));
    bp.setOn(bottomScrollPad);
  });
}

async function checkWidthPaddingsByMoire(ui: UIRunner, heightPadding: number): Promise<void | null> {
  const builder = ui.builder;
  builder.title = 'Measuring Width Padding';

  const rowHeight = 105;
  const imageHeight = rowHeight - heightPadding;
  const paddings = new Map<SizeKey, Padding>;

  type State = { width: number, tooWide: number, done: boolean };
  return multiSize(ui, (key): State => ({
    width: 1,
    tooWide: key.windowSize.width + 1,
    done: false,
  }), async (loop, key, state, addStatusRows) => {

    const windowSize = key.windowSize;
    const increment = incrementFor(state);

    // add title, and scroll padding rows
    const tp = new VariablePadding(windowSize.height * .75);
    tp.deduct(await builder.addTitleConfigRow());
    tp.deduct(await builder.addBackRow('Back', () => loop.return()));
    const topScrollPad = builder.addEmptyRow();

    if (state.done) {

      await builder.addTextRow('You have completed the padding check for this size and orientation. To check another configuration, activate another multitasking size and/or rotate your device into a different orientation.');
      await builder.addIndentRow(textCell('Multitasking is available on iPads through Split View, Slide Over, and (if the iPad supports it) Stage Manager.', { titleFont: 'footnote' }));

    } else {

      tp.deduct(await builder.addTextRow('Pick the lowest row that shows the consistent, un-blurred moiré pattern that matches the pattern shown in the first row).'));
      tp.setOn(topScrollPad);

      // add test rows
      for (let imageWidth = state.width; imageWidth < state.tooWide; imageWidth += increment)
        addRulerRow(builder.table, rowHeight, new Size(imageWidth, imageHeight), size => {
          state.width = size.width;
          state.tooWide = Math.min(state.tooWide, state.width + increment);
          if (incrementFor(state) < 1) {
            state.done = true;
            paddings.set(key, { heightPadding, widthPadding: windowSize.width - state.width });
          }
          loop.again();
        });

      // add scroll padding, and informational rows
      const bp = new VariablePadding(windowSize.height * .75);
      const bottomScrollPad = builder.addEmptyRow();
      bp.deduct(await builder.addTextRow(`current: by ${increment}, ${state.width} <= image width < ${state.tooWide}`));
      bp.setOn(bottomScrollPad);
    }

    builder.addEmptyRow();
    await addStatusRows(paddings);

    function incrementFor(state: State) {
      return powerOf(10, state.tooWide, state.width);
    }
  });
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

async function measureFonts(ui: UIRunner) {
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
  const renderHeight = (await fontMeasurer.measureString_(str, enWidth * 1.25 /* these chars wider than one en */, lineSpacing, Font.body())).height;
  const lines = Array.from(str.matchAll(/\n/g)).length + 1;
  return { lineCount: lines, height: renderHeight };
}

async function showLineBreaks(ui: UIRunner) {
  const builder = ui.builder;
  return await ui.loop(async loop => {
    await builder.addTitleConfigRow();
    await builder.addSubtitleHelpRow('Show/Measure Line Breaks');
    await builder.addBackRow('Back', () => loop.return());
    builder.addEmptyRow();
    // XXX Passages?
    await builder.addForwardRow('Artificial Examples', () => artificialExamples(ui));
    await builder.addForwardRow('Simple Numbered Lines', () => simpleNumberedLines(ui));
    await builder.addForwardRow('Compare undefined vs. "body" Font', () => compareUndefinedFont(ui));
  });
}
async function artificialExamples(ui: UIRunner) {
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
async function simpleNumberedLines(ui: UIRunner) {
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
async function compareUndefinedFont(ui: UIRunner) {
  const builder = ui.builder;
  return ui.loop(async loop => {
    await builder.addTitleConfigRow();
    await builder.addSubtitleHelpRow('Undefined Font vs. Font.body()', 'I expected a missing or undefined titleFont to be the same as Font.body(). It is not. For most sizes the "undefined" line spacing is tighter than that of Font.body(), but at xSmall it uses about a tenth of a point more per line than does Font.body().');
    await builder.addBackRow('Back', () => loop.return());
    builder.addEmptyRow();
    builder.addTextRow('Using a missing or undefined titleFont gives a different result from specifying Font.body().\n\nIs this a bug?\n\nFor most Dynamic Type sizes the "undefined font" uses a tighter line spacing than the corresponding body font, so estimating the row height based on the body font works okay.\n\nThe xSmall Dynamic Type size (the smallest one) uses a slightly looser line spacing than the xSmall body font (about a tenth of a point per line taller than the spacing that body uses). The row height has 4 extra points of padding built in (some fonts/sizes seem to need it), so it takes a several tens of lines before the undefined xSmall gets truncated when it is displayed at the height calculated for xSmall body.');
    builder.addEmptyRow();
    const a = builder.adderForTableRow([{ widthWeight: 1, align: 'right' }, { widthWeight: 1, align: 'left' }]);
    const str = numberedLines(50);
    await a(['undefined titleFont', 'titleFont: Font.body()'], { cellSpacing: 10 });
    builder.addHeightAdjuster(await a([{ title: str, titleFont: '__ undefined __' }, { title: str, titleFont: 'body' }], { cellSpacing: 10 }));
  });
}
function numberedLines(n: number) {
  return new Array(n).fill(0).map((...[, i]) => i + 1).join('\n');
}
async function measureHeights(ui: UIRunner) {
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

    const bodyFm = await ui.fontMeasurer.measureFont(Font.body());
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
          questionRow.height = estimatedHeightOf(questionText, bodyFm, bodyFm, questionWidth); // could also max with est height of buttons, too; but what is their default font? it is usually smaller than body. also it seems like it doesn't scale with Dynamic Type size?
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
function pickFont(ui: UIRunner, currentFont: NamedFont) {
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

async function showSafeAreaInsets(ui: UIRunner) {
  const builder = ui.builder;
  await ui.loop(async loop => {
    await builder.addTitleConfigRow();
    await builder.addSubtitleHelpRow('Safe Area Insets', 'This part of the program reports the horizontal (left/right) safe area insets available in a WebView. iOS provides these insets so that "full screen" web pages can avoid placing elements that might end up under the notch/island on certain devices. This should give us a numbers that can be used to reconstruct a UITableRow\'s "width padding" without needing to measure it.');
    await builder.addBackRow('Back', () => loop.return());
    builder.addEmptyRow();

    const { left, right, width, height, top, bottom, x, y } = await ui.safeAreaInsetsFetcher.getInsetsEtc();
    const text = [{ left, right }, { top, bottom }, { width, height }, { x, y }].map(o => JSON.stringify(o)).join('\n');
    await builder.addTextRow(text, { onSelect: () => loop.again() });
  });
}

async function showWidthWeights(ui: UIRunner) {
  const builder = ui.builder;
  const demoColor = Color.gray();
  const sepColor = Color.dynamic(Color.black(), Color.white());
  await ui.loop(async loop => {
    await builder.addTitleConfigRow();
    await builder.addSubtitleHelpRow('Show Zero widthWeight');
    await builder.addBackRow('Back', () => loop.return());

    builder.addEmptyRow();
    await builder.addTextRow({ title: 'Lone non-zero widthWeight cell', titleFont: 'title3' });
    addRow(r => r.addImage(rulerImage(new Size(builder.rowWidth, 44 - 16), false)).widthWeight = 1).height = 44;
    await addWidthWeightedTexts([1], 'OK: a gets full width', cells => cells[0].rightAligned());
    addSep();

    builder.addEmptyRow();
    await builder.addTextRow({ title: 'Lone zero widthWeight cell', titleFont: 'title3' });
    await builder.addIndentRow('The cell gets the whole width. Seems reasonable. These rows (especially the image row) show the extent of the "normal content area" for rows. Later examples will show some cells that are drawn just after (or even spanning) the right edge of this normal content area.');
    addRow(r => r.addImage(rulerImage(new Size(builder.rowWidth, 44 - 16), false)).widthWeight = 0).height = 44;
    await addWidthWeightedTexts([0], 'OK?: a gets full width', cells => cells[0].rightAligned());
    addSep();

    builder.addEmptyRow();
    await builder.addTextRow({ title: 'Zero widthWeight cell(s)', titleFont: 'title3' });
    await builder.addIndentRow('It seems like zero-weighted cells have their weights replaced with the minimum weight, but only after they are totaled. Since the total is used to divide up the width of the normal content area, this means that some cells can overflow (or be drawn past) the right edge of the normal content area.\n\nOOB: out of bounds (outside the normal content area)');

    await addWidthWeightedTexts([0, 0], 'OK?: a == b (zero-total special case?)');
    await addWidthWeightedTexts([0, 1], 'b just OOB');
    await addWidthWeightedTexts([1, 0], 'b just OOB');
    addSep();

    await addWidthWeightedTexts([0, 0, 0], 'OK?: a == b == c (zero-total special case?)');
    await addWidthWeightedTexts([0, 0, 1], 'a whole, b just OOB, c not visible (very OOB?)');
    await addWidthWeightedTexts([0, 1, 0], 'a whole, b just OOB, c not visible (very OOB?)');
    await addWidthWeightedTexts([0, 1, 1], 'a == b, c just OOB');
    await addWidthWeightedTexts([1, 0, 0], 'a whole, b just OOB, c not visible (very OOB?)');
    await addWidthWeightedTexts([1, 0, 1], 'a == b, c just OOB');
    await addWidthWeightedTexts([1, 1, 0], 'a == b, c just OOB');
    addSep();

    await builder.addIndentRow('Trying a mixture of non-zero weights.\n\nThese all use weights 0,0,1,2,3 with permuted placement for the zeros.\nThe 0-weighted cells end up the same size as the 1-weighted (non-zero minimum weight) cell, giving an effective total weight of 8. But the row\'s "normal content area" is only considered to be 6 wide (the sum of the original weights), so some cells either span the end of the normal content area (or are drawn just outside of it).\n\nThe notations below show the presumed "effective" weights. The vertical bar (pipe symbol) represents the end of the row\'s normal content area. If a cell spans the end, it is parenthesized and broken down to show how much fits inside and how much overflows the normal content area.');
    await addWidthWeightedTexts([0, 0, 1, 2, 3], 'like 1,1,1,2,(3=1|2)');
    await addWidthWeightedTexts([0, 1, 0, 2, 3], 'like 1,1,1,2,(3=1|2)');
    await addWidthWeightedTexts([0, 1, 2, 0, 3], 'like 1,1,2,1,(3=1|2)');
    await addWidthWeightedTexts([0, 1, 2, 3, 0], 'like 1,1,2,(3=2|1),1');
    await addWidthWeightedTexts([1, 0, 0, 2, 3], 'like 1,1,1,2,(3=1|2)');
    await addWidthWeightedTexts([1, 0, 2, 0, 3], 'like 1,1,2,1,(3=1|2)');
    await addWidthWeightedTexts([1, 0, 2, 3, 0], 'like 1,1,2,(3=2|1),1');
    await addWidthWeightedTexts([1, 2, 0, 0, 3], 'like 1,2,1,1,(3=1|2)');
    await addWidthWeightedTexts([1, 2, 0, 3, 0], 'like 1,2,1,(3=2|1),1');
    await addWidthWeightedTexts([1, 2, 3, 0, 0], 'like 1,2,3|1,1');
    addSep();

    await builder.addIndentRow('Trying non-zero minimum other than one.\n\nThese all use weights 0,0,2,4 with permuted placement for the zeros.\nThe 0-weighted cells end up the same size as the 2-weighted (non-zero minimum weight) cell, giving an effective total weight of 10. But the row\'s "normal content area" is only considered to be 6 wide (the sum of the original weights), so some cells either span the end of the normal content area (or are drawn just outside of it).\n\nThe notations below show the presumed "effective" weights. The vertical bar (pipe symbol) represents the end of the row\'s normal content area. If a cell spans the end, it is parenthesized and broken down to show how much fits inside and how much overflows the normal content area.');
    await addWidthWeightedTexts([0, 0, 2, 4], '2,2,2|4');
    await addWidthWeightedTexts([0, 2, 0, 4], '2,2,2|4');
    await addWidthWeightedTexts([0, 2, 4, 0], '2,2,(4=2|2),2');
    await addWidthWeightedTexts([2, 0, 0, 4], '2,2,2|4');
    await addWidthWeightedTexts([2, 0, 4, 0], '2,2,(4=2|2),2');
    await addWidthWeightedTexts([2, 4, 0, 0], '2,4|2,2');
    addSep();

    /*
    // these fractional widthWeights all seem be processed okay, not sure what problem I was running into that prompted me to round in apportionWidth...
    builder.addEmptyRow();
    await builder.addTextRow({ title: 'Fractional (non-integer) widthWeight', titleFont: 'title3' });
    await builder.addIndentRow('XXX summary');
    await addWidthWeightedTexts([.5, .5], 'OK: a == b');
    addSep();
    await addWidthWeightedTexts([.25, .25], 'OK: a == b');
    await addWidthWeightedTexts([.25, .75], 'OK: a == 1/4, b == 3/4');
    await addWidthWeightedTexts([.75, .25], 'OK: a == 3/4, b == 1/4');
    await addWidthWeightedTexts([.75, .75], 'OK: a == b');
    addSep();
    await addWidthWeightedTexts([1.5, 2], 'OK: a == 3/7, b == 4/7');
    */
  });

  function addRow(fn: (r: UITableRow) => void) {
    const row = new UITableRow;
    row.backgroundColor = demoColor;
    fn(row);
    builder.table.addRow(row);
    return row;
  }
  function addSep() {
    const sep = new UITableRow;
    sep.height = 3;
    sep.backgroundColor = sepColor;
    const sepSep = new UITableRow;
    sepSep.height = 2;
    builder.table.addRow(sepSep);
    builder.table.addRow(sep);
    builder.table.addRow(sepSep);
  }
  async function addWidthWeightedTexts(widthWeights: number[], note: string, cellsFn?: (cells: UITableCell[]) => void) {
    const texts = Array.from('abcde');
    if (widthWeights.length > texts.length) throw new Error('more weights than available texts');
    await builder.addTextRow(`${widthWeights.length} cell${widthWeights.length == 1 ? '' : 's'}: ww ${widthWeights} `);
    await builder.addIndentRow(note);
    const cells = widthWeights.map((ww, i) => {
      const cell = UITableCell.text(texts[i].repeat(10));
      cell.widthWeight = ww;
      return cell;
    });
    cellsFn?.(cells);
    addRow(r => cells.forEach(c => r.addCell(c))).cellSpacing = 0;
    addSep();
  }
}

await main();
