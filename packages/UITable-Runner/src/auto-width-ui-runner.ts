import safeAreaInsetsCode from 'safe-area-insets code';
import * as t from 'typanion';
import { FontMeasurer, type FontMeasures } from './measure.js';
import { FontChangeNotifier, OrientationChangeNotifier, PollingNotifier } from './polled-notifications.js';
import { openPromise } from './ts-utils.js';

type LoopFunction<T> = (loop: LoopControl<T>, info: { fontMeasures: FontMeasures, windowSize: Size, safeAreaInsets: { left: number, right: number } }) => void | Promise<unknown>;
export type LoopControl<T> = {
  again: () => void,
  return: (value: T) => void,
};

export interface AutoWidthUIBuilder {
  set rowWidth(width: number | null);
  set bodyFontMeasures(fontMeasures: FontMeasures);
}
type CreateBuilder<B extends AutoWidthUIBuilder> = (table: UITable, fontMeasurer: FontMeasurer) => Promise<B> | B;

export class AutoWidthUIRunner<B extends AutoWidthUIBuilder> {
  private constructor(
    private readonly table: UITable,
    private readonly tableClosed: Promise<'table closed'>,
    private readonly createBuilder: CreateBuilder<B>,
    public readonly builder: B,
    private readonly saiVisible: boolean,
    public readonly safeAreaInsetsFetcher: SafeAreaInsetsFetcher,
    public readonly presentationsClosed: Promise<void>,
    public readonly orientationChangeNotifier: OrientationChangeNotifier,
    public readonly multitaskingSizeChangeNotifier: MultitaskingSizeChangeNotifier,
    public readonly fontMeasurer: FontMeasurer,
    public readonly fontChangeNotifier: FontChangeNotifier,
  ) { }
  static async start<B extends AutoWidthUIBuilder>(createBuilder: CreateBuilder<B>, options: { visibleSafeAreaInsetWebView?: boolean } = {}) {
    // default to visible SAI for multitasking devices (iPad) so we can retrieve
    // the "window" size
    const opts: Required<typeof options> = { visibleSafeAreaInsetWebView: Device.isPad(), ...options };

    const safeAreaInsetsFetcher = await SafeAreaInsetsFetcher.create(opts.visibleSafeAreaInsetWebView);

    const table = new UITable;
    const tableClosed = table.present(!opts.visibleSafeAreaInsetWebView).then(() => 'table closed' as const);
    tableClosed.finally(() => safeAreaInsetsFetcher.unhideMessage());

    const fm = new FontMeasurer;

    return new AutoWidthUIRunner(
      table,
      tableClosed,
      createBuilder,
      await createBuilder(table, fm),
      opts.visibleSafeAreaInsetWebView,
      safeAreaInsetsFetcher,
      tableClosed.then(() => safeAreaInsetsFetcher.webviewClosed),
      new OrientationChangeNotifier,
      new MultitaskingSizeChangeNotifier(safeAreaInsetsFetcher),
      fm,
      await FontChangeNotifier.create(5000, fm));
  }
  async startNewTable() {
    const table = new UITable;
    const tableClosed = table.present(!this.saiVisible).then(() => 'table closed' as const);
    const builder = await this.createBuilder(table, this.fontMeasurer);
    return new AutoWidthUIRunner(
      table,
      tableClosed,
      this.createBuilder,
      builder,
      this.saiVisible,
      this.safeAreaInsetsFetcher,
      tableClosed.then(), // this new runner didn't present the SAI fetcher, so it shouldn't automatically let its users wait for it to close
      this.orientationChangeNotifier,
      this.multitaskingSizeChangeNotifier,
      this.fontMeasurer,
      this.fontChangeNotifier);
  }
  private activeLoop: { n: number, pauseFor?: (subTask: Promise<void>) => void } | undefined;
  public paddingBasedOnScreenSize = true;
  async loop<T = void>(fn: LoopFunction<T>) {
    const { promise: thisLoopFinished, resolve: releasePause } = openPromise<void>();

    const thisLoop: typeof this.activeLoop = { n: (this.activeLoop?.n ?? 0) + 1 };
    const previousLoop = this.activeLoop;

    if (previousLoop)
      if (previousLoop.pauseFor)
        previousLoop.pauseFor(thisLoopFinished);
      else
        console.error(`unable to pause loop ${previousLoop.n}`);
    this.activeLoop = thisLoop;

    try {
      const loopResult = await this.loopRunner(fn, thisLoop);

      if (this.activeLoop === thisLoop)
        this.activeLoop = previousLoop;
      else
        if (loopResult != null) // when the table closes, loops finish in the order they were started, not the "normal" finish order that would keep activeLoop consistent; this probably means that activeLoop gets stuck at the "next to last" loop when the table is closed; if another loop is started it would try to pause a loop that is no longer running, but such reuse would be invisible anyway since the table is closed
          console.warn('different loop was active when one finished');

      return loopResult;
    } finally {
      releasePause();
    }
  }
  private async loopRunner<T = void>(fn: LoopFunction<T>, pf: { pauseFor?: (subTask: Promise<void>) => void }) {

    let pausedFor: Promise<void> | undefined;
    pf.pauseFor = subTask => {
      pausedFor = subTask;
      endThisIteration?.('loop again');
      subTask.finally(() => {
        if (pausedFor === subTask)
          pausedFor = void 0;
      });
    };

    type LoopIterationResult = 'loop again' | { return: T };
    let endThisIteration: (action: LoopIterationResult | Promise<LoopIterationResult>) => void;

    const loop: LoopControl<T> = {
      again: () => endThisIteration('loop again'),
      return: (value: T) => endThisIteration({ return: value }),
    };

    let fontMeasures: FontMeasures = await this.fontChangeNotifier.measurer.measureFont(Font.body());
    let newFont = false;
    const fontSub = this.fontChangeNotifier.subscribe(fm => {
      fontMeasures = fm;
      newFont = true;
      endThisIteration?.('loop again');
    });

    let orientationChangedFromInitial = false;
    let previousSize = Device.screenSize();
    const orientationSub = this.orientationChangeNotifier.subscribe(() => {
      const newSize = Device.screenSize();
      if (newSize.width != previousSize.width || newSize.height != previousSize.height) {
        orientationChangedFromInitial = true;
        previousSize = newSize;
        endThisIteration?.('loop again');
      }
    });

    // XXX we could also skip this on non-multitasking devices (even if SAI is presented)
    const sizeSub = this.saiVisible
      ? this.multitaskingSizeChangeNotifier.subscribe(() => endThisIteration?.('loop again'))
      : void 0;

    try {
      for (; ;) {
        const endOfThisIteration = openPromise<'loop again' | { return: T }>();
        endThisIteration = endOfThisIteration.resolve;

        const event = await (async event => {
          try {
            if (!pausedFor) {
              const screenSize = Device.screenSize();
              const { left, right, top, bottom, width, height } = await this.safeAreaInsetsFetcher.getInsetsAndSizeInPoints();

              const windowSize = (() => {

                const windowSize = new Size(width, height);

                // after the first orientation change the reported size seems to be reliable
                if (orientationChangedFromInitial) return windowSize;

                // before the first orientation change, the width and height are
                // erroneously reduced by the applicable insets; try to fix
                // them, but only in a way that won't cause its own problems if
                // this bug is fixed

                if (screenSize.height - (windowSize.height + top + bottom) == 0)
                  if (
                    // full screen
                    screenSize.width - (windowSize.width + left + right) == 0
                    // Split View sizes
                    || [1 / 3, 2 / 3, 1 / 2]
                      .map(f => screenSize.width - (windowSize.width + left + right) / f)
                      .some(w => (0 <= w && w <= 20))
                    // XXX Slide Over looks like it is close to 1/3 width, but not full height...
                  ) {
                    console.log(`adjusting reported windowSize: ${windowSize.width}(+${left + right})x${windowSize.height}(+${top + bottom})`);
                    windowSize.width += left + right;
                    windowSize.height += top + bottom;
                    return windowSize;
                  }

                // for Stage Manager and any other unhandled window
                // configurations, there may be no good way to know whether the
                // bug happened or not; just return the reported size; if the
                // bug happened, then the size might be smaller than ideal (but,
                // a smaller width is safer for our line breaking purposes)
                // console.warn(`using unadjusted windowSize: ${windowSize.width}x${windowSize.height}`);

                return windowSize;
              })();

              const paddingBase = this.paddingBasedOnScreenSize ? screenSize : windowSize;
              const basePadding = Math.floor(Math.min(400, paddingBase.width, paddingBase.height) / 10 / 8) * 8;
              const contentWidth = windowSize.width - basePadding - left - right;
              if (isFinite(contentWidth))
                this.builder.rowWidth = contentWidth;
              else
                this.builder.rowWidth = null;

              if (newFont)
                this.builder.bodyFontMeasures = fontMeasures;
              newFont = false;

              this.table.removeAllRows();
              await fn(loop, { fontMeasures, windowSize, safeAreaInsets: { left, right } });
              this.table.reload();
            } else
              endThisIteration(pausedFor.then(() => 'loop again' as const));

            return await event;
          } finally {
            endOfThisIteration.reject('loop iteration ended');
          }
        })(Promise.race([
          this.tableClosed,
          endOfThisIteration.promise,
        ]));

        if (event == 'loop again') continue;
        else if (event == 'table closed')
          return null;
        return event.return;
      }
    } finally {
      sizeSub?.unsubscribe();
      orientationSub.unsubscribe();
      fontSub.unsubscribe();
    }
  }
}

const isInsets = t.isObject({
  left: t.isString(), right: t.isString(),
  top: t.isString(), bottom: t.isString(),
  width: t.isNumber(), height: t.isNumber(),
}, {
  extra: t.isObject({
    angle: t.isNumber(),
    x: t.isNumber(), y: t.isNumber(),
  })
});
class SafeAreaInsetsFetcher {
  private constructor(private readonly wv: WebView, private readonly presented: Promise<void> | false, public readonly webviewClosed: Promise<void>) { }
  /**
   * A WebView is used to query the safe area insets. This WebView can be
   * presented or left "hidden".
   *
   * When the inset-query WebView is presented, other UIs (e.g. a UITable) may
   * be presented "above" it, but these other UIs must not be presented in full
   * screen. Full screen presentations above the inset-query WebView seem to
   * prevent the WebView from updating its inset values while it is "fully
   * covered". The user will need to manually close the inset-query WebView
   * before the program can fully end.
   *
   * When the inset-query WebView is "hidden", the queries may not be as
   * reliable:
   *    * the 'right' inset never updates, and
   *    * there is often a larger delay between an orientation change and the
   *      inset values updating, and
   *    * the 'width' and 'height' seem to use placeholder values (300).
   *
   * This code attempts to compensate for these problems. Not presenting the
   * inset-query WebView is probably better UX (the user never sees this
   * non-interactive WebView presentation), but this kind of "behind-the-scenes"
   * WebView may not be an entirely supported Scriptable technique.
   *
   * Despite efforts to return stable values, the insets provided by this code
   * may occasionally be wrong. In these cases, you may get the insets that were
   * used for the prior orientation instead of the current one. This may induce
   * various width-dependent UI glitches after an orientation change (e.g. worse
   * line break estimates, incorrect widths applied to symbols/images (possibly
   * resulting in mis-sized images)).
   */
  static async create(present = true, message?: string) {
    const webView = new WebView;

    // defining with @property doesn't seem to help right when not presented, it still gets "0px" instead of the defined default
    const css = `:root{
       ${['top', 'bottom', 'left', 'right'].map(s => `--${s}:env(safe-area-inset-${s});`).join('')}
    }
    #c {
      margin: var(--top) var(--right) var(--bottom) var(--left);
    }
    #m {
      margin: 0px;
      font-size: 48px;
      text-align: center;
      visibility: hidden;
    }
    :root {
      background-color: white;
      color: black;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        background-color: black;
        color: white;
      }
    }`;
    await webView.loadHTML(`<head><meta name='viewport' content='viewport-fit=cover, width=device-width'/><style>${css}</style><div id=c><p id=m>This window is for background processing. Please close it.</p></div>`);
    await webView.evaluateJavaScript(`{
      const s = document.createElement('script');
      s.onerror = err => console.error(String(err));
      s.onload = () => completion();
      s.type = 'module';
      s.appendChild(document.createTextNode(${JSON.stringify(safeAreaInsetsCode)}));
      document.head.append(s);
    }`, true);
    if (message)
      await webView.evaluateJavaScript(`document.getElementById('m').innerText = ${JSON.stringify(message)}`);
    if (present) {
      const webviewClosed = webView.present(true);
      // for some reason, if we call evaluateJavaScript immediately after
      // presenting, the WebView will show up as blank; so wait a bit before
      // allowing the first post-presentation evaluateJavaScript call
      const presented = new Promise<void>(r => Timer.schedule(10, false, r));
      return new SafeAreaInsetsFetcher(webView, presented, webviewClosed);
    } else
      return new SafeAreaInsetsFetcher(webView, false, Promise.resolve());

  }
  async unhideMessage() {
    if (this.presented)
      await this.presented;
    await this.wv.evaluateJavaScript(`document.getElementById('m').style.visibility = 'visible'`);
  }
  private warned = false;
  async getInsetsEtc() {
    if (this.presented)
      await this.presented;

    const insets = await (async () => {
      // The inset information sometimes lags behind orientation changes. Use a
      // web-side async function that only resolves once the inset information
      // seems to be have stabilized.
      for (; ;) {
        const insets = await this.wv.evaluateJavaScript('void getStableLeftAndRightInsets().then(completion,()=>completion(null))', true);
        if (insets != null) return insets;
      }
    })();
    if (!isInsets(insets))
      throw new Error(`expected Record<'left'|'right'|'top'|'bottom',string>&Record<'width'|'height',number> for from web code (got ${JSON.stringify(insets)})`);

    // When the WebView is not presented ...
    if (!this.presented) {
      // ... 'right' never updates, so if it is different from 'left', use the
      // 'left' value (various descriptions of iOS-level safe area insets seem
      // to show that they are always the same: 0 if the notch/island is not to
      // the left or right or some value larger than the notch/island height if
      // the notch/island is on the left or right).
      if (insets.right != insets.left)
        insets.right = insets.left;

      // ... the reported size seems to always be 300x300 (a placeholder
      // value?); the best we can do is assume we are full screen; this will be
      // wrong for multitasking scenarios, but we can't do much about it other
      // than issue a warning.
      if (!Device.isPad()) {
        const screenSize = Device.screenSize();
        insets.width = screenSize.width;
        insets.height = screenSize.height;
      } else if (!this.warned) {
        console.warn('Safe Area Inset WebView must be presented on devices that offer multitasking (iPads)');
        this.warned = true;
      }
    }

    // the rest of the size fixups are done in the runner since it knows whether the orientation has been changed

    return insets;
  }
  async getLeftAndRightInPoints() {
    const { left, right } = await this.getInsetsEtc();
    return {
      left: parseInt(left),
      right: parseInt(right),
    };
  }
  async getInsetsAndSizeInPoints() {
    const { left, right, top, bottom, width, height } = await this.getInsetsEtc();
    return {
      left: parseInt(left),
      right: parseInt(right),
      top: parseInt(top),
      bottom: parseInt(bottom),
      width, height,
    };
  }
}

// this might be able to replace the orientation notifier:
// this directly checks the size, which is what we are really concerned with
// unfortunately, this is probably more expensive than the OCN (due to calls into WebView)
class MultitaskingSizeChangeNotifier extends PollingNotifier<Size> {
  constructor(private sai: SafeAreaInsetsFetcher, interval = 1000) {
    super(interval);
  }
  private size: null | Size = null;
  protected async poll() {
    const { width, height } = await this.sai.getInsetsEtc();
    if (width != this.size?.width || height != this.size?.height) {
      this.size = new Size(width, height);
      this.notify();
    }
  }
  protected notificationInfo(): { info: Size; } | null {
    return this.size && { info: this.size };
  }
}
