import { estimatedLinesForText } from './line-breaks.js';
import { type FontMeasures } from './measure.js';

export async function inspectEstimatedLines(text: string, fontMeasures: FontMeasures, width: number) {
  const lines = estimatedLinesForText(fontMeasures)(width, text);
  const a = new Alert;
  a.title = `${lines.length} Estimated Line${lines.length == 1 ? '' : 's'}`;
  a.message = lines.reduce(({ start, msg }, line, i) => ({
    start: line.beforeIndex,
    msg: `${msg}\n${i + 1} ${JSON.stringify(abbrev(text.slice(start, line.beforeIndex)))} ${(line.pointsRemaining / fontMeasures.enWidth).toFixed(2)}en ${line.breakCount} last ${(line.lastBreakPoints / fontMeasures.enWidth).toFixed(2)}en`,
  }), { start: 0, msg: '' }).msg;
  a.addCancelAction('Close');
  await a.presentSheet();
  function abbrev(str: string, endLength = 5) {
    if (str.length <= 2 * endLength + 1) return str;
    return str.slice(0, endLength) + '…' + str.slice(-endLength);
  }
}

export function estimatedHeightOf(text: string, bodyMeasures: FontMeasures, fontMeasures: FontMeasures, width: number, extraLineEvery?: number): number {
  const lineCount = estimatedLinesForText(fontMeasures)(width, text).length;
  const adjustedLineCount = extraLineEvery ? Math.trunc(lineCount * (1 + 1 / extraLineEvery)) : lineCount;
  return heightFor(
    adjustedLineCount,
    bodyMeasures, fontMeasures);
}

export function heightFor(numLines: number, bodyMeasures: FontMeasures, fontMeasures: FontMeasures) {
  // Not sure why the "starting height" (2*enWidth) is based on the body font,
  // but that is the story the numbers tell (from measuring the row heights
  // needed for 2-10 lines of every "named" font at every Dynamic Text size).
  // Only one font+size needs 4+, a couple need 1+, most are fine with 0+.
  return Math.round(4 + 2 * bodyMeasures.enWidth + fontMeasures.lineSpacing * numLines);
}
