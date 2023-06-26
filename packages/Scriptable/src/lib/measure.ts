import { type FontMeasures as LineBreakFontMeasures } from 'utils/line-breaks.js';
import * as t from 'typanion';

const isSize = t.isObject({ width: t.isNumber(), height: t.isNumber() });
const horizontalBounds = { left: t.isNumber(), right: t.isNumber() };
const verticalBounds = { top: t.isNumber(), bottom: t.isNumber() };
const isHorizontalInfo = t.isObject({ size: isSize, bounds: t.isObject(horizontalBounds) });
const isVerticalInfo = t.isObject({ size: isSize, bounds: t.isObject(verticalBounds) });
const isBothInfo = t.isObject({ size: isSize, bounds: t.isObject({ ...horizontalBounds, ...verticalBounds }) });

export class ImageMeasurer {
  private promisedMeasureWebView: Promise<WebView>;
  constructor(public readonly checkedBorderPixels: number) {
    this.promisedMeasureWebView = webViewForMeasurements();
  }

  async nontransparentWidth(image: Image, tag?: string): Promise<number> {
    const wv = await this.promisedMeasureWebView;
    const urlStr = JSON.stringify(dataURL('image/png', Data.fromPNG(image)));
    const info = await wv.evaluateJavaScript(`measureHorizontalBounds(${urlStr}).then(completion),0`, true);

    if (!isHorizontalInfo(info))
      throw new Error('measureHorizontalBounds failed');

    this.checkBorderLR(info, tag);

    const { size: { width }, bounds: { left, right } } = info;
    const scale = width / image.size.width;

    return (right - left + 1) / scale;
  }

  async nontransparentHeight(image: Image, tag?: string) {
    const wv = await this.promisedMeasureWebView;
    const urlStr = JSON.stringify(dataURL('image/png', Data.fromPNG(image)));
    const info = await wv.evaluateJavaScript(`measureVerticalBounds(${urlStr}).then(completion),0`, true);

    if (!isVerticalInfo(info))
      throw new Error('measureVerticalBounds failed');

    this.checkBorderTB(info, tag);

    const { size: { height }, bounds: { top, bottom } } = info;
    const scale = height / image.size.height;

    return (bottom - top + 1) / scale;
  }

  async nontransparentBounds(image: Image, tag?: string) {
    const wv = await this.promisedMeasureWebView;
    const urlStr = JSON.stringify(dataURL('image/png', Data.fromPNG(image)));
    const info = await wv.evaluateJavaScript(`measureBounds(${urlStr}).then(completion),0`, true);

    if (!isBothInfo(info))
      throw new Error('measureBounds failed');

    this.checkBorderLR(info, tag);
    this.checkBorderTB(info, tag);

    const { size, bounds: { left, right, top, bottom } } = info;
    const scale = size.height / image.size.height; // XXX check width scale matches?

    return new Size((right - left + 1) / scale, (bottom - top + 1) / scale);
  }

  private checkBorderLR({ size: { width }, bounds: { left, right } }: { size: { width: number }, bounds: { left: number, right: number } }, tag?: string) {
    // example with border 3
    //  012      3210
    // [   L----R   ]
    if (left < this.checkedBorderPixels)
      console.error(`${tag ? `${tag}: ` : ''}left checked-border violated: ${left} should be >= ${this.checkedBorderPixels}`);
    if (right >= width - this.checkedBorderPixels)
      console.error(`${tag ? `${tag}: ` : ''}right checked-border violated: ${right} should be < ${width - this.checkedBorderPixels}`);
  }

  private checkBorderTB({ size: { height }, bounds: { top, bottom } }: { size: { height: number }, bounds: { top: number, bottom: number } }, tag?: string) {
    // example with border 3
    //  012      3210
    // [   T----B   ]
    if (top < this.checkedBorderPixels)
      console.error(`${tag ? `${tag}: ` : ''}top checked-border violated: ${top} should be >= ${this.checkedBorderPixels}`);
    if (bottom >= height - this.checkedBorderPixels)
      console.error(`${tag ? `${tag}: ` : ''}bottom checked-border violated: ${bottom} should be < ${height - this.checkedBorderPixels}`);
  }
}

import measureImageCode from 'measure-image code';

async function webViewForMeasurements(): Promise<WebView> {
  const wv = new WebView();
  await wv.loadHTML('');
  await wv.evaluateJavaScript(`{
    const e = document.createElement('script');
    e.onerror = err => console.error(String(err));
    e.onload = () => completion();
    e.type = 'module';
     e.appendChild(document.createTextNode(${JSON.stringify(measureImageCode)}));
    document.head.append(e);
  }`, true);
  return wv;
}

const enDash = '\u2013'; // U+2013 EN DASH

export type FontMeasures = LineBreakFontMeasures & {
  enDashHeight: number,
  lineSpacing: number,
  averageDigitWidth: number,
};

export class FontMeasurer {
  constructor(private readonly imageMeasurer = new ImageMeasurer(3)) { }
  async measureString(str: string, font = Font.body()) {
    const { enWidth, lineSpacing } = await this.measureEnAndLineSpacing(font);
    return this.measureString_(str, enWidth, lineSpacing, font);
  }
  async measureString_(str: string, enWidth: number, lineSpacing: number, font = Font.body()) {
    const checkedBorder = this.imageMeasurer.checkedBorderPixels / Device.screenScale();
    const { lineCount, longestLine } = str.split(/\r\n|\n|\r/).reduce(({ lineCount, longestLine }, line) => {
      lineCount++;
      longestLine = Math.max(longestLine, line.length);
      return { lineCount, longestLine };
    }, { lineCount: 0, longestLine: 0 });

    const renderOffset = Math.ceil(enWidth);
    const size = new Size(
      Math.round(longestLine * enWidth
        + Math.max(renderOffset, checkedBorder)  // render offset and left checked border
        + checkedBorder                     // right checked border
      ),
      Math.round(lineCount * lineSpacing
        + Math.max(renderOffset, checkedBorder)  // render offset and top checked border
        + enWidth                           // above-first and below-last diacritics
        + checkedBorder                     // bottom checked border
      ));
    return this.measureString__(str, renderOffset, size, font);
  }
  private async measureString__(str: string, renderOffset: number, size: Size, font: Font): Promise<Size> {
    const image = render(str, size, renderOffset, font);
    return await this.imageMeasurer.nontransparentBounds(image, str);
  }
  async measureFont(font = Font.body()): Promise<FontMeasures> {

    const { enWidth, enDashHeight, lineSpacing } = await this.measureEnAndLineSpacing(font);

    const w = async (str: string, customEnWidth = enWidth) =>
      (await this.measureString_(str, customEnWidth, lineSpacing, font)).width;

    const spaceWidth = await (async () => {
      const count = 10;
      const spaces = ' '.repeat(count);
      const width = await w(`a${spaces}a`) - await w('aa');
      return width / count;
    })();

    const averageDigitWidth = await (async () => {
      const digits = '0123456789' + enDash;
      const customEnWidth = enWidth * 1.25; // some digits are a bit wider than one en
      const width = await w(digits, customEnWidth) - enWidth;
      return width / (digits.length - enDash.length);
    })();

    const averageLowercaseWidth = await (async () => {
      const freq = {
        // spell-checker:ignore jkqxz
        // rounded frequencies relative to v, jkqxz (more rare than v) rounded up to 1
        'a': 8, 'b': 2, 'c': 3, 'd': 4, 'e': 13,
        'f': 2, 'g': 2, 'h': 6, 'i': 7, 'j': 1,
        'k': 1, 'l': 4, 'm': 2, 'n': 7, 'o': 8,
        'p': 2, 'q': 1, 'r': 6, 's': 6, 't': 9,
        'u': 3, 'v': 1, 'w': 2, 'x': 1, 'y': 2,
        'z': 1,
      };
      const str = Object.entries(freq).map(([letter, freq]) => letter.repeat(freq)).join('') + enDash;
      const width = await w(str) - enWidth;
      return width / (str.length - enDash.length);
    })();

    const averageUppercaseWidth = await (async () => {
      const str = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + enDash;
      const customEnWidth = enWidth * 1.5; // some capitals are a bit wider than one en
      const width = await w(str, customEnWidth) - enWidth;
      return width / (str.length - enDash.length);
    })();

    return { enWidth, enDashHeight, spaceWidth, averageDigitWidth, averageLowercaseWidth, averageUppercaseWidth, lineSpacing };
  }
  async measureEnAndLineSpacing(font = Font.body()) {
    const placeHolderEnWidth = 60; // en dash width and height
    const placeHolderLineSpacing = 100;
    const { width: enWidth, height: enDashHeight } = await this.measureString_(enDash, placeHolderEnWidth, placeHolderLineSpacing, font);
    const { height: enLinesHeight } = await this.measureString_(enDash + '\n' + enDash, enWidth * 1.25, 2 * placeHolderLineSpacing, font);
    const lineSpacing = enLinesHeight - enDashHeight;
    return { enWidth, enDashHeight, lineSpacing };
  }
}

function render(text: string, size: Size, topLeftOrEnWidth: number | Point, font = Font.body()): Image {
  try {
    if (typeof topLeftOrEnWidth == 'number')
      topLeftOrEnWidth = new Point(topLeftOrEnWidth, topLeftOrEnWidth);
    const d = new DrawContext();
    d.respectScreenScale = true;
    d.size = size;
    d.opaque = false;
    d.setTextColor(Color.orange());
    d.setFont(font);
    d.drawText(text, topLeftOrEnWidth);
    return d.getImage();
  } catch (e) {
    console.error(`error rendering ${JSON.stringify(text)} in ${size.width}x${size.height}`);
    throw e;
  }
}

function dataURL(type: string, data: Data) {
  return `data:${type};base64,${data.toBase64String()}`;
}
