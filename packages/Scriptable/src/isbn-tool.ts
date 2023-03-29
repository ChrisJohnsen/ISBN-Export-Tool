// Scriptable front end for tool-core

import { isObject } from './ts-utils.js';
import { asidePathname, Store } from './scriptable-utils.js';
import { UITableUI } from './ui-uitable.js';
import { Controller } from './ui-controller.js';

// setTimeout and clearTimeout used by throttle
declare const globalThis: Record<PropertyKey, unknown>;
globalThis.setTimeout = <A extends unknown[]>(fn: (...args: A) => void, ms: number, ...args: A): Timer => {
  if (typeof fn == 'string') throw 'setTimeout with uncompiled code argument not supported';
  return Timer.schedule(ms, false, () => fn(...args));
};
globalThis.clearTimeout = (timer: Timer): void => timer.invalidate();

const store = new Store(asidePathname(module.filename, 'json'));
await store.read();
if (!store.data) store.data = {};
if (!isObject(store.data)) throw 'restored data is not an object?';
if (!store.data.UITableUIData) store.data.UITableUIData = {};
if (!isObject(store.data.UITableUIData)) throw 'restored UI data is not an object?';
if (!store.data.webcheckData) store.data.webcheckData = {};
if (!isObject(store.data.webcheckData)) throw 'restored UI data is not an object?';

const logPathname = asidePathname(module.filename, 'log');
const testLogPathname = asidePathname(module.filename, 'log', bn => bn + ' test');
const cachePathname = asidePathname(module.filename, 'json', bn => bn + ' cache');
const testCachePathname = asidePathname(module.filename, 'json', bn => bn + ' test cache');

const controller = new Controller(
  testMode => testMode ? testLogPathname : logPathname,
  testMode => testMode ? testCachePathname : cachePathname,
  store.data.webcheckData,
);

const ui = new UITableUI(controller, store.data.UITableUIData);
await ui.present(true);
await controller.abortIfRunning();

await store.write();
