// TypeScript generic stuff

export function isObject(o: unknown): o is Record<string, unknown> {
  if (!o) return false;
  if (typeof o != 'object') return false;
  return true;
}

type NoInfer<T> = [T][T extends any ? 0 : never]; // eslint-disable-line @typescript-eslint/no-explicit-any
// NoInfer used here to nudge TS into taking V from the map instead of from make return
export function getOrSetNew<K, V>(map: Map<K, V>, key: K, make: () => NoInfer<V>): V {
  if (map.has(key)) return map.get(key)!;
  const value = make();
  map.set(key, value);
  return value;
}
