export function rulerImage(size: Size, screened = true) {
  const c = new DrawContext();
  c.opaque = true;
  c.respectScreenScale = true;
  c.size = size;
  c.setFillColor(Color.orange());
  c.fillRect(new Rect(0, 0, size.width, size.height));

  const stepHeight = size.height / 10;
  let stepStart = 0;
  let upper = true;
  for (let stepWidth = 100; stepWidth >= 1; stepWidth /= 10) {
    for (; stepStart <= size.width - stepWidth; stepStart += stepWidth) {
      const step = stepStart / stepWidth;
      const stepY = ((step % 10) + 1) * stepHeight;
      const [top, height] = upper ? [0, stepY] : [stepY, size.height - stepY];

      c.setFillColor(Color.blue());
      c.fillRect(new Rect(stepStart, top, stepWidth, height));
      upper = !upper;
    }
  }

  if (screened)
    drawScreening(c);

  return c.getImage();
}

function parallels(spacing: number, angle: number): (lineWidth: number, size: Size) => (p: Path) => void {
  spacing = Math.abs(spacing);
  const slope = SlopeLike.fromAngle(angle);
  // next line passes through point after moving in perpendicular direction
  const offset = slope.scaledPerpendicularOffset(spacing);

  return (lineWidth, size) => {
    const halfLineWidth = lineWidth / 2;
    const bounds = new Rect(-halfLineWidth, -halfLineWidth, size.width + lineWidth, size.height + lineWidth);
    if (slope.isMoreVertical())
      // vertical-ish lines handled by iterating along x
      return path => {
        const basePoint = new Point(halfLineWidth, halfLineWidth);
        let end = bounds.maxX;
        const strokeSpan = boundPointsOnLineThru(bounds, basePoint, slope).width;
        if (slope.isYPositive())
          offset.backOutAtLeastWidth(basePoint, strokeSpan);
        else
          end += strokeSpan;
        for (; basePoint.x < end; offset.applyTo(basePoint))
          addLineToPath(path, boundPointsOnLineThru(bounds, basePoint, slope));
      };
    else
      // horizontal-ish lines handled by iterating along y
      return path => {
        const basePoint = new Point(halfLineWidth, halfLineWidth);
        let end = bounds.maxY;
        const strokeSpan = boundPointsOnLineThru(bounds, basePoint, slope, true).height;
        if (slope.isYPositive())
          offset.backOutAtLeastHeight(basePoint, strokeSpan);
        else
          end += strokeSpan;
        for (; basePoint.y < end; offset.applyTo(basePoint, true))
          addLineToPath(path, boundPointsOnLineThru(bounds, basePoint, slope, true));
      };
  };
}

class SlopeLike {
  private readonly dx: number;
  private readonly dy: number;
  private constructor(dx: number, dy: number) {
    // make x non-negative: push any negative sign to y part
    this.dx = Math.abs(dx);
    this.dy = dx >= 0 ? dy : -dy;
  }
  static fromAngle(angle: number) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    return new SlopeLike(dx, dy);
  }
  scaledPerpendicularOffset(scale: number): Offset {
    // negative reciprocal slope is perpendicular; keep x non-negative
    const dx = Math.abs(this.dy);
    const dy = this.dy > 0 ? -this.dx : this.dx;
    return new Offset(scale * dx, scale * dy);
  }
  isVertical() {
    return Math.abs(this.dx) < 1e-5;
  }
  isHorizontal() {
    return Math.abs(this.dy) < 1e-5;
  }
  slope() {
    return this.dy / this.dx;
  }
  isMoreVertical() {
    return Math.abs(this.dx) < Math.abs(this.dy);
  }
  isYPositive() {
    return this.dy > 0;
  }
}

class Offset {
  constructor(private readonly dx: number, private readonly dy: number) { }
  applyTo(p: Point, forceYNonNegative = false) {
    if (!forceYNonNegative || this.dy >= 0) {
      p.x += this.dx;
      p.y += this.dy;
    } else {
      p.x -= this.dx;
      p.y -= this.dy;
    }
  }
  backOutAtLeastWidth(p: Point, width: number) {
    const n = Math.round(width / this.dx);
    p.x -= n * this.dx;
    p.y -= n * this.dy;
  }
  backOutAtLeastHeight(p: Point, height: number) {
    const n = Math.round(height / Math.abs(this.dy));
    p.x -= n * this.dx * Math.sign(this.dy);
    p.y -= n * Math.abs(this.dy);
  }
}

function boundPointsOnLineThru(bounds: Rect, point: Point, slope: SlopeLike, horizontal = false) {
  if (slope.isVertical())
    return {
      start: new Point(point.x, bounds.minY),
      end: new Point(point.x, bounds.maxY),
      width: 0,
      height: bounds.height,
    };
  if (slope.isHorizontal())
    return {
      start: new Point(bounds.minX, point.y),
      end: new Point(bounds.maxX, point.y),
      width: bounds.width,
      height: 0,
    };
  const m = slope.slope();
  if (!horizontal)
    return {
      start: new Point((bounds.minY - point.y) / m + point.x, bounds.minY),
      end: new Point((bounds.maxY - point.y) / m + point.x, bounds.maxY),
      width: Math.abs((bounds.maxY - bounds.minY) / m),
      height: bounds.height,
    };
  else
    return {
      start: new Point(bounds.minX, (bounds.minX - point.x) * m + point.y),
      end: new Point(bounds.maxX, (bounds.maxX - point.x) * m + point.y),
      width: bounds.width,
      height: Math.abs((bounds.maxX - bounds.minX) * m),
    };
}

function addLineToPath(p: Path, { start, end }: { start: Point, end: Point }) {
  p.move(start);
  p.addLine(end);
}

// screenings for testing parallels rendering
// const horizontals = parallels(2, 0, 'h');
// const verticals = parallels(2, Math.PI / 2, 'v');
// const slopeOne = parallels(2, Math.PI / 4, '+one');
// const slopeMinusOne = parallels(2, -Math.PI / 4, '-one');
// const tinyAngle = 0.005;
// const nearlyHorizontals = parallels(2, tinyAngle, 'nh');
// const nearlyVerticals = parallels(2, Math.PI / 2 - tinyAngle, 'nv');
// const negNearlyHorizontals = parallels(2, -tinyAngle, '-nh');
// const negNearlyVerticals = parallels(2, -(Math.PI / 2 - tinyAngle), '-nv');
// const whirl = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
//   10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
//   20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
//   30, 31, 32, 33, 34, 35].map(a => parallels(2, (a + .1) / 36 * Math.PI - Math.PI / 2, `a${a}`));

function drawScreening(c: DrawContext): void {
  // const size = c.size;
  // const diagonals = parallels(2, Math.atan2(size.height, size.width));
  // const otherDiagonals = parallels(2, Math.atan2(size.height, -size.width));

  function path(fn: (p: Path) => void) {
    const p = new Path;
    fn(p);
    return p;
  }

  const unscreenedBorder = 2;

  if (!(c.size.height > 2 * unscreenedBorder && c.size.width > 2 * unscreenedBorder))
    return;

  const screenImage = ((size, inPoints) => {
    const c = new DrawContext;
    c.opaque = false;
    c.respectScreenScale = inPoints;
    c.size = size;

    const lineWidth = inPoints ? 1 / Device.screenScale() : 1;
    c.setLineWidth(lineWidth);

    c.setStrokeColor(Color.white());
    c.addPath(path(parallels(2, Math.PI / 2)(lineWidth, size)));
    c.strokePath();

    c.setStrokeColor(Color.black());
    c.addPath(path(parallels(1 - 1 / 50, Math.PI / 2 + 0.005)(lineWidth, size)));
    c.strokePath();

    // combinations that work (white then black)
    // white verticals every 2
    // c.addPath(path(verticals(lineWidth, size)));
    // black (nearly) verticals just under 1
    // when we subtract 1/F we get a visual "beat" every F points across the image; supplying more beats makes it easier to notice changes that only affect a few?
    // c.addPath(path(parallels(1 - 1 / 99, Math.PI / 2 - tinyAngle, 'nv~1')(lineWidth, size)));
    // c.addPath(path(parallels(1 - 1 / 99, Math.PI / 2, 'v~1')(lineWidth, size)));
    // c.addPath(path(parallels(1 - 1 / 50, Math.PI / 2 - 0.005, 'nv~1')(lineWidth, size)));

    return c.getImage();
  })(new Size(c.size.width - 2 * unscreenedBorder, c.size.height - 2 * unscreenedBorder), c.respectScreenScale);

  c.drawImageInRect(screenImage, new Rect(unscreenedBorder, unscreenedBorder, c.size.width - 2 * unscreenedBorder, c.size.height - 2 * unscreenedBorder));

  // c.setStrokeColor(Color.purple());
  // c.setFillColor(Color.green());
  // rects2(0.5, new Rect(4, 0, 10, 10), 1);

  // function rects2(lw: number, r: Rect, n = 4) {
  //   const incr = 0.5; // 1/scale?
  //   const x = r.x + lw / 2,
  //     y = r.y + lw / 2,
  //     width = r.width - lw,
  //     height = r.height - lw;
  //   c.setLineWidth(lw);
  //   for (let i = 0; i < n; i++) {
  //     c.strokeRect(new Rect(x + i * (incr + 10), y + i * incr, width, height));
  //     c.fillRect(new Rect(lw / 2 + x + i * (incr + 10), lw / 2 + y + i * incr, width - lw, height - lw));
  //   }
  // }
}
