// TypeScript generic stuff

export function isObject(o: unknown): o is Record<string, unknown> {
  if (!o) return false;
  if (typeof o != 'object') return false;
  return true;
}
