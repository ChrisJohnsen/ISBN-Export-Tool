type Insets = {
  left: string, right: string,
  top: string, bottom: string,
  angle: number,
  width: number, height: number,
  x: number, y: number,
};

export function getLeftAndRightInsets(): Insets {
  const angle = window.screen.orientation.angle;
  const cs = getComputedStyle(document.documentElement);
  const left = cs.getPropertyValue('--left');
  const right = cs.getPropertyValue('--right');
  const top = cs.getPropertyValue('--top');
  const bottom = cs.getPropertyValue('--bottom');
  const width = window.innerWidth; // if not presented, we see 300; document.documentElement.clientWidth has same issue with not being presented, and before first orientation change
  const height = window.innerHeight;
  const x = window.screenX;
  const y = window.screenY;
  // XXX does window.screenX/Y help to more fully capture multitasking configuration (e.g. which side in a split view)?
  return { left, right, angle, width, height, top, bottom, x, y };
}

export function getStableLeftAndRightInsets(): Promise<Insets> {
  const interval = 25;
  const requiredStablePeriods = 4;
  let queries = 0;
  let stableFor = 0;
  let previousInsets: Insets | undefined;
  return new Promise(poll);
  async function poll(resolve: (insets: Insets) => void, reject: (reason: Error) => void) {
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
