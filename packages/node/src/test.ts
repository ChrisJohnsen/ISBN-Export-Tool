import pp from 'papaparse';
const parse = pp.parse;

import { FileHandle, readFile } from 'node:fs/promises';
import { PathLike } from 'node:fs';

async function main(path: PathLike | FileHandle) {
  const csv = await readFile(path, { encoding: 'utf-8' });
  parse(csv, {
    step: function (results/*, parser*/) {
      console.log(results.data);
    }
  });
}

const [/*node*/, /*program*/, ...args] = process.argv;
main(args[0]).then(() => console.log('done'));
