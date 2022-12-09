import { parse, type ParseConfig } from 'papaparse';
import { unparse } from 'papaparse';

interface RowInfo {
  offset: number,
  empty?: boolean,
  missingColumns: readonly string[],
  extraColumns: readonly string[],
}

export type Row = Record<string, string>;

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
                return [];
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

import { Reducer } from './functional.js';
export { Reducer } from './functional.js';

export function reduceCSV<T>(csv: string, reducer: Reducer<Row, T>): Promise<T> {
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

export function toCSV(rows: Row[]): string;
export function toCSV(headerAndRows: string[][]): string;
export function toCSV(data: {
  header: string[],
  rows: string[][] | Row[],
}): string;
export function toCSV(arg: Row[] | string[][] | {
  header: string[],
  rows: string[][] | Row[],
}): string {
  if (Array.isArray(arg)) {
    return unparse<string[] | Row>(arg);
  } else {
    return unparse<string[] | Row>({ fields: arg.header, data: arg.rows });
  }
}
