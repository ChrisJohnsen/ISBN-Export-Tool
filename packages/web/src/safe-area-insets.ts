type Insets = { left: string, right: string };
type InsetsAndAngle = Insets & { angle: number };

export function getLeftAndRightInsets(): InsetsAndAngle {
  const angle = window.screen.orientation.angle;
  const cs = getComputedStyle(document.documentElement);
  const left = cs.getPropertyValue('--left');
  const right = cs.getPropertyValue('--right');
  return { left, right, angle };
}

export function getStableLeftAndRightInsets(): Promise<InsetsAndAngle> {
  const interval = 25;
  const requiredStablePeriods = 4;
  let queries = 0;
  let stableFor = 0;
  let previousInsets: InsetsAndAngle | undefined;
  return new Promise(poll);
  async function poll(resolve: (insets: InsetsAndAngle) => void, reject: (reason: Error) => void) {
    const insets = getLeftAndRightInsets();
    queries++;
    if (previousInsets)
      if (insets.left == previousInsets.left && insets.right == previousInsets.right) { // XXX check angle too? might need to be flexible about it (if it isn't always rounded to 0/90/180/270)
        stableFor++;
        if (stableFor >= requiredStablePeriods)
          return resolve(insets);
      } else
        stableFor = 0;
    if (queries > 2 * requiredStablePeriods) {
      console.error(`giving up on insets: only stable for ${stableFor}/${requiredStablePeriods} after ${queries}`);
      return reject(new Error(`insets only stable for ${stableFor}/${requiredStablePeriods} after ${queries}`));
    }
    previousInsets = insets;
    // requestAnimationFrame(() => poll(resolve, reject));
    setTimeout(poll, interval, resolve, reject);
  }
}
