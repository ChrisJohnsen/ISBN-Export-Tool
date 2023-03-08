// TypeScript generic stuff

export function assertNever(value: never): never { void value; throw 'assertNever called' }

export function isObject(o: unknown): o is Record<string, unknown> {
  if (!o) return false;
  if (typeof o != 'object') return false;
  return true;
}
