import { parse, type ParseConfig } from 'papaparse';

import { type FileHandle, readFile } from 'node:fs/promises';
import { type PathLike } from 'node:fs';

interface ParseOpts<T> {
  header?: boolean;
  rowFunc: (row: T) => void,
  done?: () => void,
}

// XXX enforce opts and TRow

function parseCSV<TRow>(data: string, opts: ParseOpts<TRow>) {
  let maybe_last_line = false;
  const config: ParseConfig<TRow, unknown> = {
    header: opts.header,
    step: function (result/*, parser */) {
      if (maybe_last_line) {
        throw 'data after last line?';
      }
      if (result.errors?.length > 0) {
        const errors = result.errors;
        if (errors.length == 1 && errors[0].type == 'FieldMismatch' && errors[0].code == 'TooFewFields') {
          maybe_last_line = true;
        } else {
          console.error('STEP ERROR', result.errors);
          throw ({ errors: result.errors });
        }
      } else {
        opts.rowFunc(result.data);
        // XXX might need to pass back other info from result?
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
      parseCSV<Record<string, string>>(csv, {
        header: true,
        rowFunc(row: Record<string, string>) {
          const isbn13 = row.ISBN13
          const exclusiveShelf = row['Exclusive Shelf']
          if (isbn13 == '=""' && exclusiveShelf == 'to-read') {
            console.log(n, row);
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
