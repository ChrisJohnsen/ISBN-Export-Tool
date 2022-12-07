/*
 * Some functional programming tools. This could all be replaced and/or
 * generalized by Ramda or fp-ts, but with a higher weight in code.
 */

type FlatMapper<T = any, U = T> = (arg: T) => U[];
type FlatMapperInput<T extends FlatMapper> = T extends FlatMapper<infer I, any> ? I : never;
type FlatMapperOutput<T extends FlatMapper> = T extends FlatMapper<any, infer O> ? O : never;

/*
* These utility types can be used to construct the type of the `fns` parameter of
* flatPipe. They were used to force the type chaining before switching to
* explicit arity overloaded declarations.
*/
/*
// Rewrites every function output to be the input of its next function
type PipedInputs<Fs extends FlatMapper[]> =
  Fs extends []
  ? Fs
  : Fs extends [FlatMapper]
  ? Fs
  : Fs extends [infer A extends FlatMapper, infer B extends FlatMapper, ...infer R extends FlatMapper[]]
  ? [FlatMapper<FlatMapperInput<A>, FlatMapperInput<B>>, ...PipedInputs<[B, ...R]>]
  : FlatMapper[] // a non-FlatMapper snuck in? tell them that they all need to be FlatMappers
  ;

// Rewrites every function input to be the output of its previous function
type PipedOutputs<Fs extends FlatMapper[]> =
  Fs extends []
  ? Fs
  : Fs extends [FlatMapper]
  ? Fs
  : Fs extends [...infer R extends FlatMapper[], infer Y extends FlatMapper, infer Z extends FlatMapper]
  ? [...PipedOutputs<[...R, Y]>, FlatMapper<FlatMapperOutput<Y>, FlatMapperOutput<Z>>]
  : FlatMapper[] // a non-FlatMapper snuck in? tell them that they all need to be FlatMappers
  ;
*/

type FlatPipe<Fs extends FlatMapper[]> =
  Fs extends []
  ? <T>(arg: T) => [T]
  : Fs extends [infer A extends FlatMapper]
  ? A
  : Fs extends [infer A extends FlatMapper, ...FlatMapper[], infer Z extends FlatMapper]
  ? (...args: Parameters<A>) => ReturnType<Z> : never;

export function flatPipe(): <T>(arg: T) => [T];
export function flatPipe<A, B>(
  ab: FlatMapper<A, B>
): FlatMapper<A, B>;
export function flatPipe<A, B, C>(
  ab: FlatMapper<A, B>,
  bc: FlatMapper<B, C>
): FlatMapper<A, C>;
export function flatPipe<A, B, C, D>(
  ab: FlatMapper<A, B>,
  bc: FlatMapper<B, C>,
  cd: FlatMapper<C, D>
): FlatMapper<A, D>;
export function flatPipe<A, B, C, D, E>(
  ab: FlatMapper<A, B>,
  bc: FlatMapper<B, C>,
  cd: FlatMapper<C, D>,
  de: FlatMapper<D, E>
): FlatMapper<A, E>;
export function flatPipe<Fs extends FlatMapper[]>(...fns: Fs) {
  function piper(arg: FlatMapperInput<FlatPipe<Fs>>): FlatMapperOutput<FlatPipe<Fs>>[] {
    return fns.reduce(
      (values: unknown[], fn: FlatMapper) => values.flatMap(fn),
      [arg]);
  }
  return piper;
}

type Mapper<T = any, U = T> = (arg: T) => U;

type Pipe<Fs extends Mapper[]> =
  Fs extends []
  ? <T>(arg: T) => T
  : Fs extends [infer A extends Mapper]
  ? A
  : Fs extends [infer A extends Mapper, ...Mapper[], infer Z extends Mapper]
  ? Mapper<Parameters<A>[0], ReturnType<Z>>
  : never
  ;

export function pipe(): <T>(arg: T) => T;
export function pipe<A, B>(
  ab: Mapper<A, B>
): Mapper<A, B>;
export function pipe<A, B, C>(
  ab: Mapper<A, B>,
  bc: Mapper<B, C>
): Mapper<A, C>;
export function pipe<A, B, C, D>(
  ab: Mapper<A, B>,
  bc: Mapper<B, C>,
  cd: Mapper<C, D>
): Mapper<A, D>;
export function pipe<A, B, C, D, E>(
  ab: Mapper<A, B>,
  bc: Mapper<B, C>,
  cd: Mapper<C, D>,
  de: Mapper<D, E>
): Mapper<A, E>;
export function pipe<Fs extends Mapper[]>(...fns: Fs) {
  function piper(arg: Parameters<Pipe<Fs>>[0]): ReturnType<Pipe<Fs>> {
    return fns.reduce(
      (value: unknown, fn: Mapper) => fn(value),
      arg);
  }
  return piper;
}

export interface Reducer<V, A> {
  fn: (accumulator: A, value: V) => A;
  initial: A;
}

export function collect<T, U>(flatMapper: FlatMapper<T, U>): Reducer<T, U[]> {
  return {
    fn: (acc, value) => {
      return acc.concat(flatMapper(value));
    },
    initial: []
  };
}

export function filter<T>(fn: (value: T) => boolean): FlatMapper<T> {
  return (value) => {
    if (fn(value)) {
      return [value];
    } else {
      return [];
    }
  };
}

export function map<T, U>(fn: (value: T) => U): Mapper<T[], U[]> {
  return (arr) => arr.map(fn);
}

export function pick<K extends PropertyKey>(keys: K[]): <O extends Record<PropertyKey, unknown>>(obj: O) => {
  [J in K]?: O[J];
} {
  return o => keys.reduce((newObj, key) => {
    if (key in o) {
      newObj[key] = o[key];
    }
    return newObj;
  }, Object.create(null));
}

export function prop<K extends PropertyKey>(key: K): <O extends Record<PropertyKey, unknown>>(obj: O) => O[K] {
  return o => o[key];
}

export function eq<T>(value: T): (arg: T) => boolean {
  return arg => arg == value;
}

export function not(value: boolean) {
  return !value;
}
