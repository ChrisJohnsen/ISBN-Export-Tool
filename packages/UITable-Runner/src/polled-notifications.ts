export type PollingSubscriber<T> = (info: T, unsubscribe: () => void) => void;
export abstract class PollingNotifier<T> {
  protected constructor(private _interval: number) { }

  // XXX use WeakRef to let abandoned subscriptions be cleaned out?
  private subscribers = new Set<PollingSubscriber<T>>;
  public subscribe(fn: PollingSubscriber<T>) {
    this.subscribers.add(fn);
    this.maybeStart();
    return {
      unsubscribe: () => this.unsubscribe(fn),
    };
  }
  protected unsubscribe(fn: PollingSubscriber<T>) {
    this.subscribers.delete(fn);
    this.maybeStop();
  }

  private singles = new Map<Promise<T>, { resolve: (value: T) => void, reject: (reason?: unknown) => void }>;
  public notifyOnce() {
    const { promise, resolve, reject } = openPromise<T>();
    this.singles.set(promise, { resolve, reject });
    this.maybeStart();
    return {
      promise,
      cancel: () => {
        this.singles.delete(promise);
        reject(new Error('one-time notification canceled'));
        this.maybeStop();
      },
    };
  }

  private empty() {
    return this.subscribers.size <= 0 && this.singles.size <= 0;
  }

  public set interval(interval: number) {
    this._interval = interval;
    this.stop();
    if (interval > 0)
      this.maybeStart();
  }
  private timer: Timer | null = null;
  private maybeStart() {
    if (this.timer || this.empty()) return;
    this.timer = Timer.schedule(this._interval, true, () => this.poll());
  }
  private maybeStop() {
    if (this.empty())
      this.stop();
  }
  private stop() {
    this.timer?.invalidate();
    this.timer = null;
  }

  protected abstract poll(): void;
  protected abstract notificationInfo(): { info: T } | null;
  protected notify() {
    const info = this.notificationInfo();
    if (info == null) return;

    this.subscribers.forEach(s => {
      try {
        s(info.info, () => this.unsubscribe(s));
      } catch (e) {
        console.error(e);
      }
    });

    this.singles.forEach(s => s.resolve(info.info));
    this.singles.clear();
  }
}

export class OrientationChangeNotifier extends PollingNotifier<void> {
  private orientation: Orientation;
  public constructor(interval = 1000) {
    super(interval);
    this.orientation = orientation();
  }
  protected poll() {
    const oldOrientation = this.orientation;
    this.orientation = orientation();
    if (oldOrientation != this.orientation)
      this.notify();
  }
  protected notificationInfo(): { info: void } {
    return { info: void 0 };
  }
}

type Orientation = 'portrait' | 'portrait upside down' | 'landscape left' | 'landscape right' | 'face up' | 'face down' | undefined;
function orientation(): Orientation {
  if (Device.isInPortrait()) return 'portrait';
  else if (Device.isInPortraitUpsideDown()) return 'portrait upside down';
  else if (Device.isInLandscapeLeft()) return 'landscape left';
  else if (Device.isInLandscapeRight()) return 'landscape right';
  else if (Device.isFaceUp()) return 'face up';
  else if (Device.isFaceDown()) return 'face down';
  return void 0;
}

import { FontMeasurer, type FontMeasures } from './measure.js';
import { openPromise } from './ts-utils.js';
export { type FontMeasures } from './measure.js';

export class FontChangeNotifier extends PollingNotifier<FontMeasures> {
  private constructor(interval = 5000, public readonly measurer: FontMeasurer, private measures: FontMeasures) {
    super(interval);
  }
  public static async create(interval = 5000, measurer = new FontMeasurer) {
    const measures = await measurer.measureFont(Font.body());
    return new FontChangeNotifier(interval, measurer, measures);
  }
  public subscribe(fn: PollingSubscriber<FontMeasures>) {
    fn(this.measures, () => this.unsubscribe(fn));
    return super.subscribe(fn);
  }
  protected async poll() {
    const basicMeasures = await this.measurer.measureEnAndLineSpacing(Font.body());
    if (this.measures?.enWidth != basicMeasures.enWidth
      || this.measures.lineSpacing != basicMeasures.lineSpacing) {
      const fontMeasures = await this.measurer.measureFont(Font.body());
      this.measures = fontMeasures;
      this.notify();
    }
  }
  protected notificationInfo() {
    return { info: this.measures };
  }
}
