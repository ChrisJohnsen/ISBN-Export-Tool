import { readFile } from 'node:fs/promises';
import { type BaseContext, Builtins, Cli, Command, Option, UsageError } from 'clipanion';
import { pick, parseCSVRows, toCSV } from 'utils';
import { guessFormat } from 'utils';
import { AllEditionsServices, type EditionsService, type EditionsServices, type Fetcher, getEditionsOf, type CacheData, type ProgressReporter } from 'utils';
import { bothISBNsOf } from 'utils';
import { version } from 'utils';
import * as path from 'node:path';
import { JSONFile } from 'lowdb/node';
import { Low } from 'lowdb';
import { type WriteStream } from 'node:tty';

import { groupFromName, type GroupResult, type Group } from './utils.js';

class Groups extends Command {
  static usage = Command.Usage({
    description: 'Show available groups in export data',
    details: `
      List the group names used in the specified book list export.

      The groups vary depending on the export format:
      - Goodreads exports have shelves
      - LibraryThing exports have collections and tags

      When multiple kinds of groups are present, there is a chance for
      name collisions. For commands that take a group name, the name
      can be prefixed with its "kind" and a colon to disambiguate.
      For example, If you have a collection and a tag both named
      "library", then you can use "Collection:library" or "Tag:library"
      to specify which you want to use.
    `,
    examples: [
      [
        'Show shelf names in a Goodreads export.',
        '$0 path/to/export.csv'
      ], [
        'Show Collection and Tag names in a LibraryThing export',
        '$0 path/to/export.tsv'
      ],
    ]
  });
  static paths = [['groups']];
  csvPath = Option.String();
  group = Option.String({ required: false });
  async execute() {
    const csv = await readFile(this.csvPath, { encoding: 'utf-8' });
    const rows = await parseCSVRows(csv);
    const format = guessFormat(rows);
    const info = format.groupInfo(rows);
    info.forEach((groupInfo, kind) => {
      this.context.stderr.write(`${kind}\n`);
      groupInfo.forEach((count, group) => {
        this.context.stderr.write(`    ${group}\n`);
      });
    });
    if (!this.group) return;
    const { group, message } = groupMessage(groupFromName(this.group, info), this.group);
    if (group)
      this.context.stderr.write(`\nFound ${group.kind} ${group.name}\n`);
    if (message)
      this.context.stderr.write('\n' + message + '\n');
  }
}

class MissingISBNs extends Command {
  static usage = Command.Usage({
    description: 'Extract entries without ISBNs',
    details: `
      Extract list of entries in a named group that lack ISBNs.

      These might be eBooks, or audio books.
      You might want to change which edition you have saved (and re-export)
      before using other commands that process ISBNs from the export.
    `,
    examples: [
      [
        'Extract ISBN-less entries from the `to-read` shelf of export named `export.csv`.',
        '$0 path/to/export.csv to-read'
      ], [
        'Extract ISBN-less entries from the Tag `library` of export named `export.tsv`.',
        '$0 path/to/export.tsv Tag:library'
      ],
    ]
  });
  static paths = [['missing-ISBNs'], ['missing-isbns'], ['missing'], ['mi']];
  csvPath = Option.String();
  group = Option.String();
  async execute() {
    const csv = await readFile(this.csvPath, { encoding: 'utf-8' });
    const rows = await parseCSVRows(csv);
    const format = guessFormat(rows);
    const { group, message } = groupMessage(groupFromName(this.group, format.groupInfo(rows)), this.group);
    if (message) this.context.stderr.write(message + '\n');
    if (!group) return;
    const selectedRows = format.rowsInGroup(rows, group.kind, group.name);
    const { missingISBN: noISBNRows } = format.missingAndISBNs(selectedRows);
    const someFields = noISBNRows.map(pick(Array.from(format.mainColumns)));
    const csvOut = toCSV(someFields);
    this.context.stdout.write(csvOut);
    this.context.stdout.write('\n');
    this.context.stderr.write(someFields.length.toString());
    this.context.stderr.write('\n');
  }
}

const editionsServiceSpecs: Map<string, EditionsService> = new Map([
  // spell-checker:ignore OLS LTTI OLWE
  ['OLS', 'Open Library Search'],
  ['LTTI', 'LibraryThing ThingISBN'],
  ['OLWE', 'Open Library WorkEditions'],
]);
const defaultEditionsServices: EditionsServices = new Set(AllEditionsServices);
defaultEditionsServices.delete('Open Library WorkEditions');
const specMaxLength = maxLength(editionsServiceSpecs.keys());
const acceptableEditionsServiceSpecs = (): string[] =>
  Array.from(editionsServiceSpecs.entries()).map(([spec, service]) =>
    `${pad(specMaxLength, spec)} for ${service}${defaultEditionsServices.has(service) ? '' : ' (disabled by default)'}`);
const defaultEditionsServicesSpec = (): string => {
  const m = new Map(Array.from(editionsServiceSpecs.entries()).map(([s, sn]) => [sn, s]));
  return Array.from(defaultEditionsServices).map(sn => m.get(sn)).filter((s: string | undefined): s is string => !!s).join(',');
};

class GetISBNs extends Command<CacheContext> {
  static usage = Command.Usage({
    description: 'Extract ISBNs from items in specified group',
    details: `
      For each item in the specified group that has an ISBN,
      produce its ISBN as output.
      One ISBN is produced per line.

      When using \`--editions\`, a comma separated list of service specifiers
      may also be given:

        --editions=OLS,LTTI

      If the list starts with a \`-\`, then the specified service(s) will not
      be used to answer "editions of" queries.

        --editions=-OLWE

      Acceptable service specifiers are:

${acceptableEditionsServiceSpecs().map(s => '      - ' + s).join('\n')}

      The default services set is: ${defaultEditionsServicesSpec()}
    `,
    examples: [
      ['Get ISBNs for items shelved as `to-read`.',
        '$0 getISBNs path/to/export.csv to-read'],
      ['Get ISBNs for items in collection `To read`.',
        '$0 getISBNs path/to/export.tsv \'To read\''],
      ['Get `to-read` ISBNs in both ISBN-13 and ISBN-10 (when available) versions.',
        '$0 getISBNs --both path/to/export.csv to-read'],
      ['Using any "editions of" service, get ISBNs of other editions of `to-read` items.',
        '$0 getISBNs --editions path/to/export.csv to-read'],
      ['Using specified "editions of" services, get ISBNs of other editions of `to-read` items.',
        '$0 getISBNs --editions=OLS,LTTI path/to/export.csv to-read'],
      ['Using "editions of" services except those specified, get ISBNs of other editions of `to-read` items.',
        '$0 getISBNs --editions=-LTTI path/to/export.csv to-read'],
    ]
  });
  static paths = [['get-ISBNs'], ['isbns']];
  otherEditions = Option.String('--editions', false, {
    tolerateBoolean: true,
    description: `
      Sends ISBN to external web service(s) to produce ISBN-13s of other editions of the work.
  `});
  bothISBNs = Option.Boolean('--both', {
    description: `
      Produce both ISBN-13 and ISBN-10 for any output ISBN that has equivalent versions (i.e. 978-prefixed ISBN-13s).
  ` });
  csvPath = Option.String();
  group = Option.String();
  async execute() {

    const csv = await readFile(this.csvPath, { encoding: 'utf-8' });

    const db = new Low<CacheData>(new JSONFile(this.context.cachePath), {});
    await db.read().catch(() => void 0);

    const pw = new ProgressWriter(this.context.stderr as WriteStream);
    const reporter = makeReporter(pw);

    const editionsServices: EditionsServices = (editionsOption => {
      if (!(editionsOption || typeof editionsOption == 'string'))
        return new Set;
      if (editionsOption == true)
        return defaultEditionsServices;
      const remove = editionsOption.startsWith('-');

      const services: EditionsServices =
        new Set(editionsOption.slice(remove ? 1 : 0).split(',').map(spec => {
          const service = editionsServiceSpecs.get(spec);
          if (service) return service;
          throw new UsageError(
            `Invalid --editions service specifier: ${JSON.stringify(spec)}. See \`--help\`.`
          );
        }));

      return remove
        ? new Set(Array.from(defaultEditionsServices).filter(service => !services.has(service)))
        : services;
    })(this.otherEditions);

    if (this.otherEditions && editionsServices.size == 0) {
      throw new UsageError('Effective "editions of" service list is empty!');
    }

    const rows = await parseCSVRows(csv);
    const format = guessFormat(rows);
    const { group, message } = groupMessage(groupFromName(this.group, format.groupInfo(rows)), this.group);
    if (message) this.context.stderr.write(message + '\n');
    if (!group) return;
    const selectedRows = format.rowsInGroup(rows, group.kind, group.name);
    const { isbns: extractedISBNs } = format.missingAndISBNs(selectedRows);
    const editionsISBNs = this.otherEditions
      ? await getEditionsOf(extractedISBNs, {
        fetcher: this.context.fetcher,
        services: editionsServices,
        cacheData: db.data,
        reporter,
      })
      : extractedISBNs;
    const isbns = this.bothISBNs
      ? bothISBNsOf(editionsISBNs)
      : editionsISBNs;

    pw.updateProgress();

    await db.write();

    this.context.stdout.write(Array.from(isbns).join('\n'));
    this.context.stdout.write('\n');
    this.context.stderr.write(isbns.size.toString());
    this.context.stderr.write('\n');

    if (this.otherEditions)
      this.context.stderr.write(reporter.summary() + '\n');
  }
}

class CacheClear extends Command<CacheContext> {
  static usage = Command.Usage({
    description: 'Clear remote data from the local cache',
    details: `
      Some operations fetch data from external services.

      Data that is unlikely to change often (e.g. the ISBNS of other
      editions of a book) is saved locally in the cache.
      This lets future operations avoid having to make the same remote
      requests and wait for the (same) replies.

      Some operations will take longer to run after clearing the cache.
    `,
    examples: [
      ['Clear the contents of the cache.',
        '$0 cache clear'],
    ]
  });
  static paths = [['cache', 'clear']];
  async execute() {
    const path = this.context.cachePath;
    const db = new Low<CacheData>(new JSONFile(path), {});
    db.data = {};
    await db.write();
    this.context.stderr.write(`cache cleared in ${path}\n`);
  }
}

type CacheContext = BaseContext & {
  cachePath: string,
  fetcher: Fetcher,
};

import { assertNever } from 'utils';

function groupMessage(foundGroup: GroupResult, group: string): { group?: undefined, message: string } | { group: Group, message: string } | { group: Group, message?: undefined } {
  if (foundGroup.status == 'not found')
    return { message: `No group matching "${group}" found.` };
  else if (foundGroup.status == 'ambiguous')
    return {
      message: `Group named "${group}" exists in multiple kinds: ${foundGroup.kinds.join(', ')}\n`
        + `\nPrefix a kind name to disambiguate: "${foundGroup.kinds[0]}:${group}"`
    };
  else if (foundGroup.status == 'found as tagged, original also in kinds')
    return { group: foundGroup.group, message: `${group} also exists in other kinds: ${foundGroup.kinds.join(', ')}` };
  else if (foundGroup.status == 'single')
    return { group: foundGroup.group };
  else
    assertNever(foundGroup);
}

const cli: Cli<CacheContext> = Cli.from([
  Builtins.HelpCommand, Builtins.VersionCommand,
  Groups,
  MissingISBNs,
  GetISBNs,
  CacheClear,
], { binaryName: 'isbn-tool', binaryLabel: 'ISBN export tools', binaryVersion: version });

// "editions of" helpers

import { fetcherUserAgent, serverThrottledFetcher } from 'utils';
import fetch from 'node-fetch';

const realFetcher = serverThrottledFetcher(async url => {
  const response = await fetch(url, { headers: [['User-Agent', fetcherUserAgent('Node')]] });
  const { status, statusText } = response;
  const retryAfter = response.headers.get('Retry-After');
  if (response.ok) return await response.text();
  return { status, statusText, retryAfter };
});

import { type FetchResult } from 'utils';
import { equivalentISBNs } from 'utils';

// generate fake data for the "editions of" parsers to consume so we do not make real requests while testing
async function fakeFetcher(url: string): Promise<FetchResult> {
  const randomInt = (n: number) => Math.trunc(Math.random() * n);
  await new Promise(res => setTimeout(res, randomInt(200) * 1 + 200));
  const isbnSearchMatch = url.match(/[?&]q=([ -\dxX]*)/);
  if (isbnSearchMatch) {
    const isbns = equivalentISBNs(isbnSearchMatch[1]);
    return JSON.stringify({ docs: [{ isbn: [`${isbns[0]}-1234`, ...(isbns.length > 1 ? [`${isbns[1]}-5678`] : [])] }] });
  }

  const isbnMatch = url.match(/\/isbn\/(.*)\.json$/);
  if (isbnMatch) return JSON.stringify({ works: [{ key: `/works/OL${equivalentISBNs(isbnMatch[1])[0]}W` }] });

  const workMatch = url.match(/\/works\/OL(.*)W\/editions\.json$/);
  if (workMatch) {
    const isbns = equivalentISBNs(workMatch[1]);
    return JSON.stringify({ entries: [{ isbn_13: [`${isbns[0]}-1234`], ...(isbns.length > 1 ? { isbn_10: [`${isbns[1]}-5678`] } : {}) }] });
  }

  const thingMatch = url.match(/thingISBN\/(.*)$/);
  if (thingMatch) {
    const isbns = equivalentISBNs(thingMatch[1]);
    return `<idlist>${[`${isbns[0]}-1234`, ...(isbns.length > 1 ? [`${isbns[1]}-5678`] : [])].map(i => `<isbn>${i}</isbn>`).join('')}</idlist>`;
  }

  throw `nope: ${url}`;
}

// let other normal output lines be written above an updatable "progress line"
// updateProgress('some text') to activate or update the "progress line"
// updateProgress() to disable the "progress line" so that direct output can happen again
// writeLine(text) to write the string and a newline; if the "progress line" is active, this writes it above the progress line and reestablishes the progress line
class ProgressWriter {
  private displayedProgress?: string;
  constructor(private tty: WriteStream) { }
  writeLine(str: string) {
    this.tty.write(this.getClearText() + str + '\n' + this.getProgressText());
  }
  updateProgress(progress?: string): void {
    const clearOld = this.getClearText();
    this.displayedProgress = this.truncateProgress(progress);
    const newProgress = this.getProgressText();
    this.tty.write(clearOld + newProgress);
  }
  get columns() {
    return this.tty.columns;
  }
  private getClearText() {
    return this.displayedProgress
      ? '\x1B[G\x1B[K\x1B[A'  // CHA EL CUU: go to column 1, erase to right, up 1 line
      : '';
  }
  private getProgressText() {
    return this.displayedProgress
      ? '\n' + this.displayedProgress
      : '';
  }
  private truncateProgress(line?: string) {
    if (!line) return line;
    const lines = line.split('\n', 1);
    return lines[0].slice(0, this.tty.columns - 1);
  }
}

// take "editions of" progress reports and accumulate statistics, make "progress line" updates, and log a few things
const makeReporter: (pw: ProgressWriter) => ProgressReporter & { summary(): void } =
  pw => {
    let total: number | undefined = void 0, started = 0, finished = 0;
    let fetchN = 0;

    // setup collection for some counts
    const map = new Map<string, { planned: number, hits: number, queries: number, fetches: number, warnings: number, faults: number, began: number | undefined, ended: number | undefined, fetchDurations: number[] }>;
    const summary = (service: string) => {
      {
        const summary = map.get(service);
        if (summary) return summary;
      }
      const summary = { planned: 0, hits: 0, queries: 0, fetches: 0, warnings: 0, faults: 0, began: undefined, ended: undefined, fetchDurations: [] };
      map.set(service, summary);
      return summary;
    };

    // the main "reporter"
    const reporter: ProgressReporter = report => {
      const event = report.event;

      // log rejections
      if (event == 'rejection')
        return pw.writeLine(report.reason.toString());

      if (event == 'abort fn') return;

      // store planned query counts and compute total for progress line
      if (event == 'query plan') {
        total = Array.from(report.plan.values()).reduce((t, isbns) => t + isbns.size, 0);
        Array.from(report.plan.entries()).forEach(([service, isbns]) => summary(service).planned = isbns.size);
        return;
      }

      const service = report.service;

      // store cache hit counts
      if (event == 'service cache hit') {
        summary(service).hits++;
        return;
      }

      // store query count, update progress line
      if (event == 'service query started') {
        const s = summary(service);
        s.queries++;
        if (!s.began) s.began = Date.now();
        return pw.updateProgress(progressBarText(pw.columns, ++started, finished, total));
      }

      // store query count, update progress line
      if (event == 'service query finished') {
        const s = summary(service);
        s.warnings += report.warnings.length;
        s.faults += report.faults.length;
        if (report.warnings.length > 0)
          pw.writeLine(`${report.service} ${report.isbn} warning: ${report.warnings.map(w => w.description).join('; ')}`);
        if (report.faults.length > 0)
          pw.writeLine(`FAULT processing ${report.service} ${report.isbn}:\n${report.faults.map(f => '  ' + f.description).join('\n')}`);
        s.ended = Date.now();
        return pw.updateProgress(progressBarText(pw.columns, started, ++finished, total));
      }

      // log fetched URLs
      if (event == 'fetch started') {
        summary(service).fetches++;
        return pw.writeLine(`${++fetchN}: ${service} ${report.url}`);
      }

      // record fetch durations
      if (event == 'fetch finished') {
        summary(service).fetchDurations.push(report.elapsed);
      }
    };

    const maxServiceNameLength = maxLength(AllEditionsServices);

    // extra function to generate final summary text
    return Object.assign(reporter, {
      summary: () => {
        const entries = Array.from(map.entries());
        // get totals
        const { hits, queries, planned } = entries.reduce(
          (t, [, summary]) => {
            (['hits', 'queries', 'planned'] as const).forEach(p => t[p] += summary[p]);
            return t;
          },
          { hits: 0, queries: 0, planned: 0 });
        // per service summaries
        const stats = (durations: number[]) => {
          if (durations.length < 1) return '';
          const sorted = Array.from(durations).sort((a, b) => a - b);
          const median = (ns: number[]) => {
            if (ns.length % 2)
              return ns[(ns.length + 1) / 2 - 1];
            const half = ns.length / 2;
            return ns.slice(half - 1, half + 1).reduce((s, v) => s + v, 0) / 2;
          };
          return ` ${sorted[0]}/${median(sorted)}/${sorted[sorted.length - 1]} (ms)`;
        };
        return entries.map(([service, summary]) =>
          ''
          + `${pad(maxServiceNameLength, service)}: h:${summary.hits} `
          + `q:${summary.queries}/${summary.planned}; `
          + `f:${summary.fetches}`
          + (summary.began && summary.ended
            ? ` (${(summary.fetches * 1000 / (summary.ended - summary.began)).toFixed(3)}/s)`
            : '')
          + `${stats(summary.fetchDurations)}`
          + `${summary.warnings > 0 ? ` warnings: ${summary.warnings}` : ''}`
          + `${summary.faults > 0 ? ` FAULTS!: ${summary.faults}` : ''}`, '').join('\n') + '\n'
          + `Total h:${hits} + q:${queries}/${planned} = ${hits + queries}; f:${fetchN}\n`
          + '(h = cache hits, q = queried/planned, f = fetches & /second & min/median/max duration)';
      }
    });
  };

// progress bar: one column per event in each of three states: finished, active, and remaining
// compress the bar if there aren't enough columns to hold them
function progressBarText(columns: number, started: number, finished: number, total: number | undefined): string {
  const active = started - finished;
  const workingTotal = total ?? started;
  const remaining = workingTotal - started;
  const summary = total ? ` ${finished} + ${active} + ${remaining} = ${total}` : ` ${finished} + ${active}`;
  const maxWidth = columns - (summary.length + 1);
  const width = Math.min(workingTotal ?? 40, maxWidth);
  const bit = width / workingTotal;
  const rep = (c: string, n: number) => Array(Math.max(n > 0 ? 1 : 0, Math.trunc(n))).fill(c).join('');
  const fin = rep('O', bit * finished);
  const rem = rep('.', bit * remaining);
  const act = rep('o', width - fin.length - rem.length);
  const line = fin + act + rem;
  return `${line}${summary}`;
}

function maxLength(is: Iterable<{ length: number; }>): number {
  let max = 0;
  for (const i of is) {
    max = Math.max(max, i.length);
  }
  return max;
}

function pad(n: number, s: string): string {
  return s.length >= n ? s : Array(n - s.length + 1).join(' ') + s;
}

function getTempPath(filename: string): string {
  const dirPath = process.env.TEMP;
  if (!dirPath) throw 'no TEMP environment variable for getTempPath';
  return path.join(dirPath, filename);
}

const args = process.argv.slice(2); // skip node and program file

let testMode = true;

if (args.length > 0) {
  const firstArg = args[0];
  if (firstArg == '--test' || firstArg == '--no-test') {
    args.shift();
    testMode = firstArg == '--test';
  }
}

const context = testMode ? {
  cachePath: getTempPath(`${cli.binaryName} test cache.json`),
  fetcher: fakeFetcher,
} : {
  cachePath: getTempPath(`${cli.binaryName} cache.json`),
  fetcher: realFetcher,
};

cli.runExit(args, context);
