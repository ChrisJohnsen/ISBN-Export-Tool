// TypeScript generic stuff

export function isObject(o: unknown): o is Record<string, unknown> {
  if (!o) return false;
  if (typeof o != 'object') return false;
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpenPromise<T> = { promise: Promise<T>, resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void };
export function openPromise<T>(): OpenPromise<T> {
  let resolve!: OpenPromise<T>['resolve'];
  let reject!: OpenPromise<T>['reject'];
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

