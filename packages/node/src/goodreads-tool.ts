import { readFile } from 'node:fs/promises';
import { Builtins, Cli, Command, Option } from 'clipanion';
import { collect, pipe, flatPipe, filter, prop, eq, map, pick, not } from 'utils';
import { reduceCSV, toCSV } from 'utils';

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
    await reduceCSV(csv,
      collect(
        pipe(
          flatPipe(
            filter(pipe(prop('ISBN13'), eq('=""'))),
            filter(pipe(prop('Exclusive Shelf'), eq('to-read'))),
          ),
          map(pick(['Book Id', 'Title', 'Author', 'Bookshelves'])),
        ))
    ).then(noISBNs =>
      [toCSV(noISBNs), noISBNs.length]
    ).then(([csv, count]) => {
      this.context.stdout.write(csv);
      this.context.stdout.write('\n');
      this.context.stderr.write(count.toString());
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
    await reduceCSV(csv,
      collect(
        pipe(
          flatPipe(
            filter(pipe(prop('Exclusive Shelf'), eq(this.shelf))),
            filter(pipe(prop('ISBN13'), eq('=""'), not)),
          ),
          map(prop('ISBN13')),
          map(isbn => isbn.replace(/^="(.*)"$/, '$1')),
        ))
    ).then(isbns => {
      this.context.stdout.write(isbns.join('\n'));
      this.context.stdout.write('\n');
      this.context.stderr.write(isbns.length.toString());
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
