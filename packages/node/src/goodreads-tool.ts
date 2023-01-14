import { readFile } from 'node:fs/promises';
import { Builtins, Cli, Command, Option } from 'clipanion';
import { pick, toCSV } from 'utils';
import { missingISBNs, getISBNs } from './tool-core.js';

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
    const noISBNRows = await missingISBNs(csv, 'to-read');
    const someFields = noISBNRows.map(pick(['Book Id', 'Title', 'Author', 'Bookshelves']));
    const csvOut = toCSV(someFields);
    this.context.stdout.write(csvOut);
    this.context.stdout.write('\n');
    this.context.stderr.write(someFields.length.toString());
    this.context.stderr.write('\n');
  }
}

class GetISBNs extends Command {
  static usage = Command.Usage({
    description: 'Extract ISBNs from items on specified shelf',
    details: `
      For each item on the specified shelf that has an ISBN,
      produce its ISBN as output.
      One ISBN is produced per line.
    `,
    examples: [
      ['Get ISBNs for items shelved as `to-read`.',
        '$0 getISBNs path/to/export.csv to-read'],
      ['Get `to-read` ISBNs in both ISBN-13 and ISBN-10 (when available) versions.',
        '$0 getISBNs --both path/to/export.csv to-read'],
    ]
  });
  static paths = [['get-ISBNs'], ['isbns']];
  bothISBNs = Option.Boolean('--both', {
    description: `
      Produce both ISBN-13 and ISBN-10 for any output ISBN that has equivalent versions (i.e. 978-prefixed ISBN-13s).
  ` });
  csvPath = Option.String();
  shelf = Option.String();
  async execute() {

    const csv = await readFile(this.csvPath, { encoding: 'utf-8' });


    const isbns = Array.from(await getISBNs(
      csv,
      this.shelf,
      { bothISBNs: !!this.bothISBNs },
    ));

    this.context.stdout.write(isbns.join('\n'));
    this.context.stdout.write('\n');
    this.context.stderr.write(isbns.length.toString());
    this.context.stderr.write('\n');
  }
}

const cli: Cli = Cli.from([
  Builtins.HelpCommand, Builtins.VersionCommand,
  MissingISBNs,
  GetISBNs,
], { binaryName: 'goodreads-tool', binaryLabel: 'Goodreads export tools', binaryVersion: '0.1' });

cli.runExit(process.argv.slice(2));
