import pp from 'papaparse';
const parse = pp.parse;

import { FileHandle, readFile } from 'node:fs/promises';
import { PathLike } from 'node:fs';

interface ResolveReject<T> {
  resolve: (value: T) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reject: (reason?: any) => void;
}
class ResolvablePromiseQueue<T, R> {
  theResolvers: ResolveReject<T>[] = [];
  thePromises: Promise<T>[] = [];

  #queueNewPromise() {
    const p = new Promise<T>((res, rej) => {
      const resolve: ResolveReject<T>['resolve'] = res,
        reject: ResolveReject<T>['reject'] = rej;
      this.theResolvers.push({ resolve, reject });
    });
    this.thePromises.push(p);
  }
  #nextResolver(): ResolveReject<T> {
    if (this.theResolvers.length <= 0) {
      this.#queueNewPromise();
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.theResolvers.shift()!
  }
  resolveNext(value: T): void {
    this.#nextResolver().resolve(value);
  }
  rejectNext(reason: R): void {
    this.#nextResolver().reject(reason);
  }
  nextPromise(): Promise<T> {
    if (this.thePromises.length <= 0) {
      this.#queueNewPromise();
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.thePromises.shift()!;
  }
}

async function* parser<TRow, TInput = unknown>(data: TInput, opts: Omit<pp.ParseLocalConfig<TRow, TInput>, "step">): AsyncGenerator<TRow> {
  const pq = new ResolvablePromiseQueue<Result, EmptyLastLine | OtherError | Complete>();

  class Result {
    parser: pp.Parser;
    data: TRow;
    constructor(parser: pp.Parser, result: TRow) { this.parser = parser; this.data = result; }
  }
  class EmptyLastLine {
    parser: pp.Parser;
    constructor(parser: pp.Parser) { this.parser = parser; }
  }
  class OtherError {
    parser: pp.Parser;
    errors: pp.ParseError[];
    constructor(parser: pp.Parser, errors: pp.ParseError[]) { this.parser = parser; this.errors = errors; }
  }
  class Complete { }

  const config: pp.ParseLocalConfig<TRow, TInput> = {
    ...opts,
    step: function (results, parser) {
      parser.pause();
      if (results.errors?.length > 0) {
        const errors = results.errors;
        if (errors.length == 1 && errors[0].type == 'FieldMismatch' && errors[0].code == 'TooFewFields') {
          pq.rejectNext(new EmptyLastLine(parser));
        } else {
          console.error('STEP ERROR', results.errors);
          pq.rejectNext(new OtherError(parser, results.errors));
        }
      } else {
        pq.resolveNext(new Result(parser, results.data));
      }
    },
    complete() {
      pq.rejectNext(new Complete())
    }
  };
  parse(data, config);

  let last_line = false;
  while (true) {
    try {
      const result = await pq.nextPromise();
      if (last_line) {
        throw 'data after last empty? line';
      }
      yield result.data;
      result.parser.resume();
    } catch (e) {
      if (e instanceof Complete) { return; }
      if (e instanceof EmptyLastLine) {
        last_line = true;
      } else if (e instanceof OtherError) {
        console.error('parse error', e.errors);
        return;
      } else {
        console.error('error', e);
        return;
      }
    }
  }
}

async function main(path: PathLike | FileHandle) {
  const csv = await readFile(path, { encoding: 'utf-8' });
  let n = 1;
  try {
    for await (const row of parser<Record<string, string>>(csv, { header: true })) {
      const isbn13 = row.ISBN13
      const exclusiveShelf = row['Exclusive Shelf']
      if (isbn13 == '=""' && exclusiveShelf == 'to-read') {
        console.log(n, row);
        n++
      }
    }
  } catch (e) {
    console.log('main error', e);
  }
}

const [/*node*/, /*program*/, ...args] = process.argv;
main(args[0]).then(() => console.log('done')).catch(e => console.error('top error', e));
