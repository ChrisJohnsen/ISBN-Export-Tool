import { describe, test, expect, jest } from '@jest/globals';
import { otherEditionsOfISBN, type Fetcher } from 'utils';

describe('edition fetcher', () => {
  test('minimal responses', async () => {
    const isbn = '9876543210';
    const isbnURL = `https://openlibrary.org/isbn/${isbn}.json`;
    /* redirects to
    const bookId = 'OL123456789M';
    const bookURL = `https://openlibrary.org/books${bookId}.json`;
     */
    const workId = 'OL123456789W';
    const bookResponse = JSON.stringify({
      works: [{ key: `/works/${workId}` }],
    });

    const editionsURL = `https://openlibrary.org/works/${workId}/editions.json`;
    const editionISBNs = ['9876543210', [], '8765432109876', ['7654321098', '6543210987654']];
    function tagged(isbns: (string | string[])[]) {
      const tag = (isbn: string) => isbn.length == 10 ? { isbn_10: isbn } : { isbn_13: isbn };
      return isbns.map(is => Array.isArray(is) ? Object.assign({}, ...is.map(tag)) : tag(is));
    }
    const editionsResponse = JSON.stringify({
      entries: tagged(editionISBNs),
    });
    const fetcher = jest.fn<Fetcher>()
      .mockResolvedValueOnce(bookResponse)
      .mockResolvedValueOnce(editionsResponse);

    const result = await otherEditionsOfISBN(fetcher, isbn);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, isbnURL);
    expect(fetcher).toHaveBeenNthCalledWith(2, editionsURL);
    expect(fetcher).toHaveReturnedTimes(2);
    expect(result).toStrictEqual(editionISBNs.flat());
  });
});
