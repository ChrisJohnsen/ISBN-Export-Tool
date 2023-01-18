import { collect, pipe, flatPipe, filter, prop, eq } from './functional.js';
import { equivalentISBNs } from './isbn.js';
import { reduceCSV, Row } from './csv.js';

export async function missingISBNs(csv: string, shelf: string): Promise<Row[]> {
  return await reduceCSV(csv, collect(
    flatPipe(
      filter(pipe(prop('ISBN13'), eq('=""'))),
      filter(onShelf(shelf)),
    )));
}

export async function getISBNs(
  csv: string,
  shelf: string,
  { bothISBNs = false }:
    { bothISBNs?: boolean } = {},
): Promise<Set<string>> {

  const csvISBNs = new Set(await reduceCSV(csv, collect(
    row => onShelf(shelf, row)
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

function onShelf(shelf: string, row: Row): boolean;
function onShelf(shelf: string): (row: Row) => boolean;
function onShelf(shelf: string, row?: Row): ((row: Row) => boolean) | boolean {

  const _onShelf = (row: Row) => row
    .Bookshelves
    .split(/\s*,\s*/)
    .includes(shelf);

  if (typeof row == 'undefined')
    return _onShelf;
  else
    return _onShelf(row);
}
