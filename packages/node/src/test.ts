import pp from 'papaparse';
const parse = pp.parse;

import { FileHandle, readFile } from 'node:fs/promises';
import { PathLike } from 'node:fs';

interface ResolveReject<T> {
  resolve: (value: T) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reject: (reason?: any) => void;
}
class ResolvablePromiseQueue<T> {
  theResolvers: ResolveReject<T>[] = [];
  thePromises: Promise<T>[] = [];

  #queueNewPromise() {
    let resolve: ResolveReject<T>['resolve'],
      reject: ResolveReject<T>['reject'];
    const p = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.theResolvers.push({ resolve, reject });
    this.thePromises.push(p);
  }
  #nextResolver(): ResolveReject<T> {
    if (this.theResolvers.length <= 0) {
      this.#queueNewPromise();
    }
    return this.theResolvers.shift()
  }
  resolveNext(value: T): void {
    this.#nextResolver().resolve(value);
  }
  rejectNext(reason): void {
    this.#nextResolver().reject(reason);
  }
  nextPromise(): Promise<T> {
    if (this.thePromises.length <= 0) {
      this.#queueNewPromise();
    }
    return this.thePromises.shift();
  }
}

// TRow is ParsedRow is header: true, or string[] if header: false
// is this representable? Check TRow and force header?
async function* parser<TRow, TInput = unknown>(data: TInput, opts: Omit<pp.ParseLocalConfig<TRow, TInput>, "step">): AsyncGenerator<TRow> {
  const pq = new ResolvablePromiseQueue<TRow>();

  const config: pp.ParseLocalConfig<TRow, TInput> = {
    ...opts,
    step: function (results, parser) {
      console.log(results, parser);
      if (results.errors?.length > 0) {
        const errors = results.errors;
        if (errors.length == 1 && errors[0].type == 'FieldMismatch' && errors[0].code == 'TooFewFields') {
          pq.rejectNext('empty last line?');
        } else {
          console.error('STEP ERROR', results.errors);
          pq.rejectNext(`results.errors: ${JSON.stringify(results.errors)}`);
        }
      } else {
        pq.resolveNext(results.data);
      }
    },
    complete() {
      pq.rejectNext('COMPLETE')
    }
  };
  parse(data, config);

  let last_line = false;
  while (true) {
    try {
      yield await pq.nextPromise();
      if (last_line) {
        throw 'data after last empty? line';
      }
    } catch (e) {
      if (e == 'COMPLETE') { return; }
      if (e == 'empty last line?') {
        last_line = true;
      } else {
        console.error('parse error', e);
        return;
      }
    }
  }
}

interface ParsedRow {
  [header: string]: string
}

async function main(path: PathLike | FileHandle) {
  const csv = await readFile(path, { encoding: 'utf-8' });
  let n = 1;
  for await (const row of parser<string[]>(csv, { /* header: true  */ })) {
    const isbn13 = row[6]; // row.ISBN13
    const exclusiveShelf = row[18]; // row['Exclusive Shelf']
    if (isbn13 == '=""' && exclusiveShelf == 'to-read') {
      console.log(n, row);
      n++
    }
  }
}

const [/*node*/, /*program*/, ...args] = process.argv;
main(args[0]).then(() => console.log('done')).catch(e => console.error('error', e));
