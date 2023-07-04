// Attempt to reproduce line breaks used in a text UITableCell

// This is probably inaccurate, but maybe not entirely useless.

// originally from Scriptable-hosted font measurement
export type LineBreakFontMeasures = {
  enWidth: number,
  spaceWidth: number,
  averageLowercaseWidth: number,
  averageUppercaseWidth: number,
};

const breakAfter = new Set(Array.from(' !-/?|}').map(c => c.codePointAt(0)).flatMap(c => c ? [c] : []));

export type EstimatedLine = { breakCount: number, beforeIndex: number, pointsRemaining: number, lastBreakPoints: number };

export function estimatedLinesForText(fontMeasures: LineBreakFontMeasures): (width: number, text: string, safetyMargin?: number) => EstimatedLine[] {
  return (width, text, safetyMargin = 3 * fontMeasures.enWidth) => {
    type PotentialBreak = { before: number, widthSince: number };
    let potentialBreak: PotentialBreak | null = null;
    const breaks: PotentialBreak[] = [];
    let lineWidth = 0;
    const lines: EstimatedLine[] = [];
    const addLine = (beforeIndex: number, breaks: PotentialBreak[]) => lines.push({
      breakCount: breaks.length,
      beforeIndex,
      pointsRemaining: width - lineWidth,
      lastBreakPoints: (breaks.at(breaks.length - 1)?.widthSince) ?? 0,
    });
    for (let i = 0; i < text.length;) {
      let printing = true;
      let breakpointAfter: boolean | 'forced' = false;
      let chWidth;
      const c = text.codePointAt(i);

      if (c == null) continue;

      if (breakAfter.has(c))
        breakpointAfter = true;

      if (c == 10) {
        // LF
        chWidth = 0;
        printing = false;
        breakpointAfter = 'forced';
      } else if (c == 32) {
        // SP
        chWidth = fontMeasures.spaceWidth;
        printing = false;
      } else if (97 <= c && c <= 122)
        // lowercase
        chWidth = fontMeasures.averageLowercaseWidth;
      else if (65 <= c && c <= 90)
        // uppercase
        chWidth = fontMeasures.averageUppercaseWidth;
      else
        chWidth = fontMeasures.enWidth;

      if (potentialBreak)
        if (lineWidth + potentialBreak.widthSince + chWidth + safetyMargin > width && printing) {
          addLine(potentialBreak.before, breaks.splice(0).slice(0, -1));
          lineWidth = potentialBreak.widthSince + chWidth;
          potentialBreak = null;
        } else
          potentialBreak.widthSince += chWidth;
      else
        if (lineWidth + chWidth + safetyMargin > width && printing) {
          addLine(i, []);
          lineWidth = chWidth;
        } else
          lineWidth += chWidth;

      i += String.fromCodePoint(c).length;
      if (breakpointAfter == 'forced') {
        addLine(i, breaks.splice(0));
        lineWidth = 0;
        potentialBreak = null;
      } else if (breakpointAfter) {
        if (potentialBreak)
          lineWidth += potentialBreak.widthSince;
        potentialBreak = { before: i, widthSince: 0 };
        breaks.push(potentialBreak);
      }
    }
    if (potentialBreak)
      lineWidth += potentialBreak.widthSince;
    addLine(text.length, breaks);
    return lines;
  };
}
