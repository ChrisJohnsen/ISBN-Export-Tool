export function apportionWidth<T extends Record<'widthWeight', number>>(things: readonly T[], width: number, cellSpacing = 2): (T & { width: number })[] {
  // XXX (rounds to) zero widthWeight is inconsistent? It is possible to sneak
  // in a zero widthWeight cell at the end of the row without affecting
  // available (image) width. This "extra, zero-widthWeight cell at the end"
  // works in landscape too (does not affect available image width), where it
  // gets a bit more display width. A zero widthWeight at the beginning takes up
  // nearly the whole row (actually, seems to be everything except the part that
  // a zero widthWeight cell at the end can use?).

  // It seems that widthWeights are rounded before being summed or divided
  // inside Scriptable.
  const rounded = things.map(thing =>
    ({ ...thing, width: Math.round(thing.widthWeight) }));
  const totalWeight = rounded.reduce((t, c) => t + c.width, 0);
  if (cellSpacing)
    width -= cellSpacing * (things.length - 1);
  return rounded.map(thing =>
    ({ ...thing, width: Math.round(thing.width / totalWeight * width) })); // total might not quite equal width!
}
