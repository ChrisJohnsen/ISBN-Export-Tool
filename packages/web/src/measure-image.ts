type Dimensions = { width: number, height: number };
type HorizontalBounds = { left: number, right: number };
type VerticalBounds = { top: number, bottom: number };

/**
 * For the image at `url`, return the its pixel dimensions, and the horizontal
 * bounds of its not-completely-transparent pixels (0-based,
 * left-most/right-most column indices).
 *
 * `url` may be a data URL.
 *
 * Note: both `left` and `right` are inclusive. The spanned width is
 *
 *     right - left + 1
 *
 * Returns null if unable to load the URL as an image or if image is completely
 * transparent.
 */
export async function measureHorizontalBounds(url: string): Promise<{ size: Dimensions, bounds: HorizontalBounds } | null> {

  const imageData = await getImageData(url);
  if (!imageData) return null;
  const { width, height } = imageData;

  const h = horizontalBounds(imageData);
  if (!h) return null;

  return {
    size: { width, height },
    bounds: h,
  };
}

/**
 * For the image at `url`, return the its pixel dimensions, and the vertical
 * bounds of its not-completely-transparent pixels (0-based,
 * top-most/bottom-most row indices).
 *
 * `url` may be a data URL.
 *
 * Note: both `top` and `bottom` are inclusive. The spanned height is
 *
 *     bottom - top + 1
 *
 * Returns null if unable to load the URL as an image or if image is completely
 * transparent.
 */
export async function measureVerticalBounds(url: string): Promise<{ size: Dimensions, bounds: VerticalBounds } | null> {

  const imageData = await getImageData(url);
  if (!imageData) return null;
  const { width, height } = imageData;

  const v = verticalBounds(imageData);
  if (!v) return null;

  return {
    size: { width, height },
    bounds: v,
  };
}

/**
 * For the image at `url`, return the its pixel dimensions, and the bounds of
 * its not-completely-transparent pixels (0-based left-most/right-most column,
 * and top-most/bottom-most row indices).
 *
 * `url` may be a data URL.
 *
 * Note: both `left`, `right`, `top`, and `bottom` are inclusive. The spanned
 * width and height are:
 *
 *     right - left + 1
 *     bottom - top + 1
 *
 * Returns null if unable to load the URL as an image or if image is completely
 * transparent.
 */
export async function measureBounds(url: string): Promise<{ size: Dimensions, bounds: HorizontalBounds & VerticalBounds } | null> {

  const imageData = await getImageData(url);
  if (!imageData) return null;
  const { width, height } = imageData;

  const h = horizontalBounds(imageData);
  if (!h) return null;

  const v = verticalBounds(imageData);
  if (!v) return null;

  return {
    size: { width, height },
    bounds: { ...h, ...v },
  };
}

async function getImageData(url: string): Promise<ImageData | null> {

  // load image from URL
  const source = document.createElement('img');
  source.src = url;
  if (!source.complete)
    await new Promise(resolve => { source.addEventListener('load', resolve) });
  const width = source.naturalWidth;
  const height = source.naturalHeight;

  // create a canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  // draw image on canvas
  const c = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!c) return null;
  c.drawImage(source, 0, 0);

  return c.getImageData(0, 0, width, height);
}

function horizontalBounds(imageData: ImageData): { left: number, right: number } | null {

  const left = leftBound(imageData);
  if (left == null) return null;

  const right = rightBound(imageData, left) ?? left;

  return { left, right };
}

/**
 * Return the left-most column of `imageData` that has at least one pixel that
 * is not completely transparent (i.e. alpha != 0).
 *
 * Return null if no such column is found to the left of `stopColumn` (which
 * defaults to `imageData.width`, i.e. check the whole image).
 */
function leftBound(imageData: ImageData, stopColumn?: number): number | null {
  const { width, height, data } = imageData;
  stopColumn ??= width;
  for (let column = 0; column < width && column < stopColumn; column++)
    for (let row = 0; row < height; row++)
      if (data[4 * (row * width + column) + 3] != 0)
        return column;
  return null;
}

/**
 * Return the right-most column of `imageData` that has at least one pixel
 * that is not completely transparent (i.e. alpha != 0).
 *
 * Return null if no such column is found to the right of `stopColumn` (which
 * defaults to -1, i.e. check the whole image).
 */
function rightBound(imageData: ImageData, stopColumn?: number): number | null {
  const { width, height, data } = imageData;
  stopColumn ??= -1;
  for (let column = width - 1; column >= 0 && column >= stopColumn + 1; column--)
    for (let row = height - 1; row >= 0; row--)
      if (data[4 * (row * width + column) + 3] != 0)
        return column;
  return null;
}

function verticalBounds(imageData: ImageData): { top: number, bottom: number } | null {

  const top = upperBound(imageData);
  if (top == null) return null;

  const bottom = lowerBound(imageData, top) ?? top;

  return { top, bottom };
}

/**
 * Return the upper-most row of `imageData` that has at least one pixel that is
 * not completely transparent (i.e. alpha != 0).
 *
 * Return null if no such row is found above `stopRow` (which defaults to
 * `imageData.height`, i.e. check the whole image).
 */
function upperBound(imageData: ImageData, stopRow?: number): number | null {
  const { width, height, data } = imageData;
  stopRow ??= height;
  const firstAlpha = 3;
  const startOfStopRow = 4 * stopRow * width;
  for (let p = firstAlpha; p < startOfStopRow; p += 4)
    if (data[p] != 0)
      return Math.trunc(p / 4 / width);
  return null;
}

/**
 * Return the lower-most row of `imageData` that has at least one pixel that is
 * not completely transparent (i.e. alpha != 0).
 *
 * Return null if no such row is found below `stopRow` (which defaults to -1,
 * i.e. check the whole image).
 */
function lowerBound(imageData: ImageData, stopRow?: number): number | null {
  const { width, height, data } = imageData;
  stopRow ??= -1;
  const lastAlpha = 4 * width * height - 1;
  const endOfStopRow = 4 * (stopRow + 1) * width - 1;
  for (let p = lastAlpha; p > endOfStopRow; p -= 4)
    if (data[p] != 0)
      return Math.trunc(p / 4 / width);
  return null;
}
