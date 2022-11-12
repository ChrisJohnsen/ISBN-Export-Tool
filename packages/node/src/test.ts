import { parse, type ParseConfig } from 'papaparse';

import { type FileHandle, readFile } from 'node:fs/promises';
import { type PathLike } from 'node:fs';

interface RowInfo {
  offset: number,
  empty?: boolean,
  missingColumns: readonly string[],
  extraColumns: readonly string[],
}

interface ParseOpts {
  row: (row: Record<string, string>, info: RowInfo) => void,
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

async function main(path: PathLike | FileHandle) {
  const csv = await readFile(path, { encoding: 'utf-8' });

  return new Promise((resolve, reject) => {
    try {
      let n = 1;
      parseCSV(csv, {
        row(rowObj) {
          const isbn13 = rowObj.ISBN13
          const exclusiveShelf = rowObj['Exclusive Shelf']
          if (isbn13 == '=""' && exclusiveShelf == 'to-read') {
            console.log(n, rowObj);
            n++
          }
        },
        done() { resolve(null) },
      });
    } catch (e) {
      console.log('main error', e);
      reject({ error: 'main error', info: e });
    }
  });
}

const [/*node*/, /*program*/, ...args] = process.argv;
main(args[0]).then(() => console.log('top done')).catch(e => console.error('top error', e));
