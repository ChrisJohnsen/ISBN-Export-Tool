import { describe, test, expect } from '@jest/globals';
import { equivalentISBNs, normalizeISBN, validateISBN } from 'utils';

describe('validateISBN', () => {
  test.each([
    '0765392763',
    '0-7653 9276-3',
    '0765392771',
    '0 7653-9277 1',
    '153842424X',
    '1-5384-2424-X',
    '9780765392763',
    '978-0-7653-9276-3',
    '9780765392770',
    '978-0 7653-9277 0',
    '9781538424247',
    '978-1-5384 2424-7',
    '9791000000008',
    '979 1 0000 0000 8',
  ])('true for valid ISBNs', isbn => {
    expect(validateISBN(isbn)).not.toBeFalsy();
  });

  test.each([
    '0765392760',
    '0765392761',
    '0765392762',
    '0765392764',
    '0765392765',
    '0765392766',
    '0765392767',
    '0765392768',
    '0765392769',
    '076539276X',
    '9780765392760',
    '9780765392761',
    '9780765392762',
    '9780765392764',
    '9780765392765',
    '9780765392766',
    '9780765392767',
    '9780765392768',
    '9780765392769',
    'NotAnISBN',
    'not an isbn',
    '1234567890',
    '1234567890123',
  ])('false for ISBNs with bad check digits', isbn => {
    expect(validateISBN(isbn)).toBeFalsy();
  });
});

describe('equivalentISBNs', () => {
  test.each([
    ['not an\t isbn', 'NOTANISBN'],
    ['12-345\r6789-0', '1234567890'],
    ['123-45-678\n 9012 3', '1234567890123'],
  ])('just normalizes invalid ISBNs', (notISBN, normal) => {
    expect(equivalentISBNs(notISBN)).toStrictEqual([normal]);
  });

  test.each([
    ['0765392763', '9780765392763'],
    ['0765392771', '9780765392770'],
    ['153842424X', '9781538424247'],
  ])('valid ISBN-10: also yields ISBN-13', (isbn10, isbn13) => {
    const result = equivalentISBNs(isbn10);

    expect(isbn10).toHaveLength(10);
    expect(isbn13).toHaveLength(13);
    expect(result).toHaveLength(2);
    expect(result).toContain(isbn10);
    expect(result).toContain(isbn13);
  });

  test.each([
    ['9780765392763', '0765392763'],
    ['9780765392770', '0765392771'],
    ['9781538424247', '153842424X'],
  ])('valid 978 ISBN-13: also yields ISBN-10', (isbn13, isbn10) => {
    const result = equivalentISBNs(isbn13);

    expect(isbn10).toHaveLength(10);
    expect(isbn13).toHaveLength(13);
    expect(result).toHaveLength(2);
    expect(result).toContain(isbn13);
    expect(result).toContain(isbn10);
  });

  test.each([
    ['0 7653-9276 3', '978 0-7653 9276-3'],
    ['0-7653 9277-1', '978-0 7653-9277 0'],
    ['1 5384 2424-X', '978-1-5384 2424 7'],
  ])('hyphens and spaces are disregarded and not returned', (isbn10, isbn13) => {
    const result10 = equivalentISBNs(isbn10);
    const result13 = equivalentISBNs(isbn13);

    const bare10 = normalizeISBN(isbn10);
    const bare13 = normalizeISBN(isbn13);

    expect(bare10).toHaveLength(10);
    expect(bare13).toHaveLength(13);
    expect(result10).toHaveLength(2);
    expect(result10).toContain(bare10);
    expect(result10).toContain(bare13);
    expect(result13).toHaveLength(2);
    expect(result13).toContain(bare10);
    expect(result13).toContain(bare13);
  });

  test.each([
    '9791000000008',
    '979-10 00-00000 8',
  ])('valid 979 ISBN-13: yields nothing extra', untenable => {
    const result = equivalentISBNs(untenable);
    const bare = normalizeISBN(untenable);

    expect(bare).toHaveLength(13);
    expect(result).toHaveLength(1);
    expect(result).toContain(bare);
  });
});
