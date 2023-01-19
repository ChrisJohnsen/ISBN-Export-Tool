import { describe, test, expect } from '@jest/globals';
import { outdent } from 'outdent';
import { missingISBNs, Row } from 'utils';

describe('missingISBNs', () => {

  test('not really CSV', async () => {
    const csv = outdent`
      This is just a string. It is
      not particularly CSV-like, but it
      might be interpreted like that.
    `;

    await expect(missingISBNs(csv, 'to-read')).rejects.toBeDefined();
  });

  test('no Bookshelves columns', async () => {
    const csv = outdent`
      id,ISBN13
      100,100000
      101,
      102,"="""""
      103,103000
      104,"=""104000"""
      105,105000
    `;

    await expect(missingISBNs(csv, 'to-read')).rejects.toBeDefined();
  });

  test('no ISBN or ISBN13 column', async () => {
    const csv = outdent`
      id,Bookshelves
      200,to-read
      101,read
      102,currently-reading
      103,"read, other"
      204,"third, to-read"
      205,to-read
    `;
    const result = await missingISBNs(csv, 'to-read');

    // missing column is same as empty
    expect(ids(result)).toStrictEqual([200, 204, 205]);
  });

  test('just Bookshelves/ISBN13 columns', async () => {
    const csv = outdent`
      id,Bookshelves,ISBN13
      100,read,100000
      201,to-read
      202,to-read,
      203,to-read,"="""""
      104,to-read,104000
      105,to-read,"=""105000"""
      106,read,106000
    `;
    const result = await missingISBNs(csv, 'to-read');

    expect(ids(result)).toStrictEqual([201, 202, 203]);
  });

  test('just Bookshelves/ISBN columns', async () => {
    const csv = outdent`
      id,Bookshelves,ISBN
      100,read,1000
      201,to-read
      202,to-read,
      203,to-read,"="""""
      104,to-read,1040
      105,to-read,"=""1050"""
      106,read,1060
    `;
    const result = await missingISBNs(csv, 'to-read');

    expect(ids(result)).toStrictEqual([201, 202, 203]);
  });

  test('just Bookshelves/ISBN/ISBN13 columns', async () => {
    const csv = outdent`
      id,Bookshelves,ISBN,ISBN13
      100,read,1000,100000
      201,to-read
      102,read,1020,102000
      203,to-read,
      204,to-read,,
      205,to-read,,"="""""
      106,to-read,,106000
      107,to-read,,"=""107000"""
      108,read,1080,108000
      209,to-read,"="""""
      210,to-read,"=""""",
      211,to-read,"=""""","="""""
      112,to-read,"=""""",112000
      113,to-read,"=""""","=""113000"""
      114,read,1140,114000
      115,to-read,1150
      116,to-read,1160,
      117,to-read,1170,"="""""
      118,to-read,1180,118000
      119,to-read,1190,"=""119000"""
      120,read,1200,120000
      120,to-read,"=""1200"""
      121,to-read,"=""1210""",
      122,to-read,"=""1220""","="""""
      123,to-read,"=""1230""",123000
      124,to-read,"=""1240""","=""124000"""
      125,read,1250,125000
    `;
    const result = await missingISBNs(csv, 'to-read');

    expect(ids(result)).toStrictEqual([201, 203, 204, 205, 209, 210, 211]);
  });

  test('item on multiple shelves', async () => {
    const csv = outdent`
      id,Bookshelves,ISBN,ISBN13
      100,read,1000,100000
      201,to-read,"=""""","="""""
      202,"to-read,other","=""""","="""""
      203,"to-read, other","=""""","="""""
      204,"other,to-read","=""""","="""""
      205,"other, to-read","=""""","="""""
      206,"other,to-read,third","=""""","="""""
      207,"other, to-read, third","=""""","="""""
      208,"other,to-read, third","=""""","="""""
      209,"other, to-read,third","=""""","="""""
      110,read,1100,110000
    `;
    const result = await missingISBNs(csv, 'to-read');

    expect(ids(result)).toStrictEqual([201, 202, 203, 204, 205, 206, 207, 208, 209]);
  });

  test('item on other shelf', async () => {
    const csv = outdent`
      id,Bookshelves,ISBN,ISBN13
      100,read,1000,100000
      101,to-read,"=""""","="""""
      102,"to-read,other","=""""","="""""
      103,"to-read, other","=""""","="""""
      104,"other,to-read","=""""","="""""
      105,"other, to-read","=""""","="""""
      206,"other,to-read,third","=""""","="""""
      207,"other, to-read, third","=""""","="""""
      208,"other,to-read, third","=""""","="""""
      209,"other, to-read,third","=""""","="""""
      110,read,1100,110000
    `;
    const result = await missingISBNs(csv, 'third');

    expect(ids(result)).toStrictEqual([206, 207, 208, 209]);
  });

  function ids(rows: Row[]): number[] {
    return rows.map(row => parseInt(row.id));
  }
});
