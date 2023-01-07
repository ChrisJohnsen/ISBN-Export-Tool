// ISBN validation and conversion

/**
 * Strip spaces and hyphens, and convert to uppercase. Does not check for
 * validity.
 */
export function normalizeISBN(isbnish: string): string {
  return isbnish.replace(/\s|-/g, '').toUpperCase();
}

import { parse } from 'isbn3';
/// <reference path='./isbn3.d.ts'/>

/**
 * Returns true if the given string is a valid ISBN.
 *
 * In addition to verifying the check digit, this will also verify whether the
 * ISBN is a part of a currently-defined ISBN group range. This means that some
 * numbers with otherwise correct check digits may be rejected.
 */
export function validateISBN(maybeISBN: string): boolean {
  return !!parse(maybeISBN);
}

/**
 * If the given string is a valid ISBN (i.e. as per `validateISBN`), return all
 * equivalent ISBNs (ISBN-13 and, if applicable, ISBN-10).
 *
 * Given a valid ISBN-10, return it and its 978-prefixed ISBN-13 equivalent.
 *
 * Given a valid 978-prefixed ISBN-13, return it and its ISBN-10 equivalent.
 *
 * Given a valid non-978-prefixed ISBN-13, return just it.
 *
 * Returned values are the non-hyphenated versions of the ISBN.
 *
 * If the given string is not a valid ISBN, return just a "normalized" version
 * of the string (stripped of spaces and hyphens).
 */
export function equivalentISBNs(isbn: string): [string] | [string, string] {
  const validISBN = parse(isbn);
  if (validISBN?.isbn10 && validISBN.isbn13) return [validISBN.isbn13, validISBN.isbn10];
  else if (validISBN?.isbn13) return [validISBN.isbn13];
  else return [normalizeISBN(isbn)];
}
