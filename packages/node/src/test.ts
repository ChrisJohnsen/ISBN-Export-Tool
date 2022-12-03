
/* ******** *
 *  csv
 * ******** */
import { parse, unparse, type ParseConfig } from 'papaparse';

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

// import {type Reducer} from 'reducer.js'

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
      reject({ error: 'reduce error', info: e });
    }
  });
}

/* ******** *
 *  reducer
 * ******** */

interface Reducer<V, A> {
  fn: (accumulator: A, value: V) => A,
  initial: A
}

type FlatMapper<T = any, U = T> = (arg: T) => U[];
type FlatMapperInput<T extends FlatMapper> = T extends FlatMapper<infer I, any> ? I : never;
type FlatMapperOutput<T extends FlatMapper> = T extends FlatMapper<any, infer O> ? O : never;

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

type PipeOf<Fs extends FlatMapper[]> =
  Fs extends []
  ? <T>(arg: T) => [T]
  : Fs extends [infer A extends FlatMapper]
  ? A
  : Fs extends [infer A extends FlatMapper, ...FlatMapper[], infer Z extends FlatMapper]
  ? (...args: Parameters<A>) => ReturnType<Z>
  : never
  ;

function pipe(): <T>(arg: T) => [T];
function pipe<A, B>(
  ab: FlatMapper<A, B>
): FlatMapper<A, B>;
function pipe<A, B, C>(
  ab: FlatMapper<A, B>,
  bc: FlatMapper<B, C>
): FlatMapper<A, C>;
function pipe<A, B, C, D>(
  ab: FlatMapper<A, B>,
  bc: FlatMapper<B, C>,
  cd: FlatMapper<C, D>
): FlatMapper<A, D>;
function pipe<A, B, C, D, E>(
  ab: FlatMapper<A, B>,
  bc: FlatMapper<B, C>,
  cd: FlatMapper<C, D>,
  de: FlatMapper<D, E>
): FlatMapper<A, E>;
function pipe<Fs extends FlatMapper[]>(...fns: Fs): PipeOf<Fs> {
  function piper(arg: FlatMapperInput<PipeOf<Fs>>): FlatMapperOutput<PipeOf<Fs>>[] {
    return fns.reduce(
      (values: unknown[], fn: FlatMapper) =>
        values.flatMap(fn),
      [arg]);
  }
  return (
    <PipeOf<Fs>> // can avoid this type assertion if we also remove the PipeOf return type; loses the fancy generic return type in the zero functions case though
    piper);
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

/* ******** *
 * util
 * ******** */

type PropKey = string | number | symbol;

function pick<K extends PropKey>(keys: K[]): <O extends Record<PropKey, unknown>>(obj: O) => { [J in K]?: O[J] } {
  return o =>
    keys.reduce((newObj, key) => {
      if (key in o) {
        newObj[key] = o[key];
      }
      return newObj;
    }, Object.create(null));
}

function propEq<K extends PropKey, V>(key: K, value: V): <O extends Record<PropKey, unknown>>(obj: O) => boolean {
  return o => key in o && o[key] == value;
}

function not<A extends unknown[]>(fn: (...args: A) => boolean): (...args: A) => boolean {
  return (...args: A) => !fn(...args);
}

/* ******** *
 * main
 * ******** */

import { readFile } from 'node:fs/promises';

import { Builtins, Cli, Command, Option } from 'clipanion';

class MissingISBNs extends Command {
  static usage = Command.Usage({
    description: 'Extract to-read entries without ISBNs',
    details: `
      Extract list of entries from the to-read shelf that lack ISBNs.

      These might be eBooks, or audio books.
      You might want to change which edition you have shelved (and re-export)
      before using other commands that process ISBNs from the to-read shelf.
    `,
    examples: [
      [
        'Extract ISBN-less to-read entries from export named `export.csv`.',
        '$0 path/to/export.csv'
      ],
    ]
  });
  static paths = [['missing-ISBNs'], ['missing-isbns'], ['missing'], ['mi']];
  csvPath = Option.String();
  async execute() {
    const csv = await readFile(this.csvPath, { encoding: 'utf-8' });
    reduceCSV(csv,
      collect(
        pipe(
          filter(propEq('ISBN13', '=""')),
          filter(propEq('Exclusive Shelf', 'to-read')),
        ))
    ).then(noISBNs => {
      this.context.stdout.write(unparse(noISBNs.map(pick(['Book Id', 'Title', 'Author', 'Bookshelves']))));
      this.context.stdout.write('\n');
      this.context.stderr.write(noISBNs.length.toString());
      this.context.stderr.write('\n');
    });
  }
}

class GetISBNs extends Command {
  static usage = Command.Usage({
    description: 'Extract ISBNs from items on specified shelf',
    details: `
      For each items on the specified shelf, produce its ISBN as output.
      One ISBN is produced per line.
    `,
    examples: [
      ['Get ISBNs for items shelved as `to-read`.',
        '$0 getISBNs path/to/export.csv to-read']
    ]
  });
  static paths = [['get-ISBNs'], ['isbns']];
  csvPath = Option.String();
  shelf = Option.String();
  async execute() {
    const csv = await readFile(this.csvPath, { encoding: 'utf-8' });
    reduceCSV(csv,
      collect(
        pipe(
          filter(propEq('Exclusive Shelf', this.shelf)),
          filter(not(propEq('ISBN13', '=""'))),
        ))
    ).then(items => {
      items.forEach(item => {
        const plainISBN = item.ISBN13.replace(/^="(.*)"$/, '$1');
        this.context.stdout.write(plainISBN);
        this.context.stdout.write('\n');
      });
      this.context.stderr.write(items.length.toString());
      this.context.stderr.write('\n');
    });
  }
}

Cli.from([
  Builtins.HelpCommand, Builtins.VersionCommand,
  MissingISBNs,
  GetISBNs,
], { binaryName: 'goodreads-tool', binaryLabel: 'Goodreads export tools', binaryVersion: '0.1' })
  .runExit(process.argv.slice(2), {});
