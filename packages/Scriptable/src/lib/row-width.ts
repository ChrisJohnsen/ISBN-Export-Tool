export function apportionWidth<T extends Record<'widthWeight', number>>(things: readonly T[], width: number, cellSpacing = 2): (T & { width: number })[] {
  const totalWeight = things.reduce((t, c) => t + Math.abs(c.widthWeight) || NaN, 0);
  if (!isFinite(totalWeight) || totalWeight == 0)
    throw new RangeError('each apportioned widthWeight must be finite and non-zero');
  if (cellSpacing)
    width -= cellSpacing * (things.length - 1);
  return things.map(thing =>
    ({ ...thing, width: Math.round(Math.abs(thing.widthWeight) / totalWeight * width) })); // total might not quite equal width!
}
