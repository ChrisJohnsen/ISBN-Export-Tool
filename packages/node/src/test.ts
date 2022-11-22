import { parse, type ParseConfig } from 'papaparse';

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

function reduceCSV<T>(csv: string, fn: (accumulator: T, rowObj: Row) => T, initial: T): Promise<T> {
  return new Promise((resolve, reject) => {
    let accumulator = initial;
    try {
      parseCSV(csv, {
        row(rowObj) {
          accumulator = fn(accumulator, rowObj);
        },
        done() { resolve(accumulator) },
      });
    } catch (e) {
      console.log('reduce error', e);
      reject({ error: 'reduce error', info: e });
    }
  });
}

async function main(path: PathLike | FileHandle) {
  const csv = await readFile(path, { encoding: 'utf-8' });
  reduceCSV(csv, (noISBNs: Row[], row) => {
    const isbn13 = row.ISBN13
    const exclusiveShelf = row['Exclusive Shelf']
    if (isbn13 == '=""' && exclusiveShelf == 'to-read') {
      noISBNs.push(row);
    }
    return noISBNs;
  }, []).then(noISBNs => {
    noISBNs.forEach((row, n) => {
      console.log(n + 1, row);
    })
  });
}

const [/*node*/, /*program*/, ...args] = process.argv;
main(args[0]).then(() => console.log('top done')).catch(e => console.error('top error', e));
