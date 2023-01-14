import { collect, pipe, flatPipe, filter, prop, eq, equivalentISBNs } from 'utils';
import { reduceCSV, Row } from 'utils';

export async function missingISBNs(csv: string, shelf: string): Promise<Row[]> {
  return await reduceCSV(csv, collect(
    flatPipe(
      filter(pipe(prop('ISBN13'), eq('=""'))),
      filter(pipe(prop('Exclusive Shelf'), eq(shelf))),
    )));
}

export async function getISBNs(
  csv: string,
  shelf: string,
  { bothISBNs = false }:
    { bothISBNs?: boolean } = {},
): Promise<Set<string>> {

  const csvISBNs = new Set(await reduceCSV(csv, collect(
    row => row['Exclusive Shelf'] == shelf
      ? (['ISBN13', 'ISBN'] as const)
        .flatMap(isbnKey => isbnKey in row ? [row[isbnKey]] : [])
        .map(isbnStr => isbnStr.replace(/^="(.*)"$/, '$1'))
        .filter(isbn => isbn != '')
        .slice(0, 1)
      : []
  )));

  const allISBNs =
    !bothISBNs
      ? csvISBNs
      : (() => {
        const bothISBNs = new Set<string>;
        csvISBNs.forEach(isbn => equivalentISBNs(isbn).forEach(isbn => bothISBNs.add(isbn)));
        return bothISBNs;
      })();

  return allISBNs;
}
