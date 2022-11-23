import { parse, unparse, type ParseConfig } from 'papaparse';

import { type FileHandle, readFile } from 'node:fs/promises';
import { type PathLike } from 'node:fs';

interface RowInfo {
  offset: number,
  empty?: boolean,
  missingColumns: readonly string[],
  extraColumns: readonly string[],
}

type Row = Record<string, string>;

interface ParseOpts {
  row: (row: Row, info: RowInfo) => void,
  done?: () => void,
}

function parseCSV(data: string, opts: ParseOpts) {
  let previousLineWasEmpty = false;
  let firstRow: readonly string[] | undefined;
  const config: ParseConfig<string[], never> = {
    step: function (result/*, parser */) {
      if (result.errors?.length > 0) {
        console.error('STEP ERROR', result.errors);
        throw { error: 'ParseError', offset: result.meta.cursor, details: result.errors };
      } else {
        const data = result.data;
        if (data.length == 1 && data[0] == '') {
          previousLineWasEmpty = true;
        } else {
          if (!firstRow) {
            firstRow = Object.freeze(data);
          } else {
            if (previousLineWasEmpty) {
              // emit empty row, then continue
              opts.row({}, { empty: true, offset: result.meta.cursor, extraColumns: [], missingColumns: firstRow });
              previousLineWasEmpty = false;
            }
            const rowObj = Object.fromEntries(firstRow.flatMap((columnHeader, i) => {
              if (i >= data.length) {
                return []
              } else {
                return [[columnHeader, data[i]]];
              }
            }));
            const info: RowInfo = { offset: result.meta.cursor, missingColumns: [], extraColumns: [] };
            if (data.length > firstRow.length) {
              info.extraColumns = data.slice(firstRow.length);
            } else if (data.length < firstRow.length) {
              info.missingColumns = firstRow.slice(data.length);
            }
            opts.row(rowObj, info);
          }
        }
      }
    },
    complete() {
      opts.done?.();
    }
  };
  parse(data, config);
}

interface Reducer<V, A> {
  fn: (accumulator: A, value: V) => A,
  initial: A
}

function reduceCSV<T>(csv: string, reducer: Reducer<Row, T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let accumulator = reducer.initial;
    try {
      parseCSV(csv, {
        row(rowObj) {
          accumulator = reducer.fn(accumulator, rowObj);
        },
        done() { resolve(accumulator) },
      });
    } catch (e) {
      console.log('reduce error', e);
      reject({ error: 'reduce error', info: e });
    }
  });
}

type FlatMapper<T, U = T> = (value: T) => U[];
type FlatMapper2 = (value: any) => unknown[];
type Piped<ABR> =
  ABR extends [infer A, ...infer BR] ?
  (A extends FlatMapper<infer Ain, infer Aout> ?
    BR extends [] ?
    FlatMapper<Ain, Aout> :
    (BR extends [infer B, ...infer R] ?
      (B extends FlatMapper<infer Bin, infer Bout> ?
        (Aout extends Bin ?
          (R extends [] ?
            FlatMapper<Ain, Bout> :
            Piped<[Piped<[A, B]>, ...R]>) :
          never) :
        never) :
      never) :
    never) :
  never;
function pipe<F extends FlatMapper2[]>(...flatMappers: F): Piped<F> {
  function piper(...args: Parameters<Piped<F>>): ReturnType<Piped<F>> {
    return <ReturnType<Piped<F>>>flatMappers.reduce((values: unknown[], fn): unknown[] => {
      return values.flatMap(fn);
    }, args);
  }
  return <Piped<F>>piper;
}

function collect<T, U>(flatMapper: FlatMapper<T, U>): Reducer<T, U[]> {
  return {
    fn: (acc, value) => {
      return acc.concat(flatMapper(value));
    },
    initial: []
  };
}

function filter<T>(fn: (value: T) => boolean): FlatMapper<T> {
  return (value) => {
    if (fn(value)) {
      return [value];
    } else {
      return [];
    }
  };
}

async function main(path: PathLike | FileHandle) {
  const csv = await readFile(path, { encoding: 'utf-8' });
  reduceCSV(csv,
    collect(
      pipe(
        filter((row: Row) => row.ISBN13 == '=""'),
        filter((row: Row) => row['Exclusive Shelf'] == 'to-read'),
      )
    ),
  ).then(noISBNs => {
    console.log(unparse(noISBNs.map(row => {
      return {
        Title: row['Title'],
        Author: row['Author'],
      };
    })));
    console.log(noISBNs.length);
  });
}

const [/*node*/, /*program*/, ...args] = process.argv;
main(args[0]).then(() => console.log('top done')).catch(e => console.error('top error', e));
