export type Fetcher = (url: string) => Promise<string>;

export function otherEditionsOfISBN(fetch: Fetcher, isbn: string): Promise<string[]>
export function otherEditionsOfISBN(fetch: Fetcher): (isbn: string) => Promise<string[]>;
export function otherEditionsOfISBN(fetch: Fetcher, isbn?: string): Promise<string[]> | ((isbn: string) => Promise<string[]>) {
  async function more(isbn: string): Promise<string[]> {
    const edition = JSON.parse(await fetch(`https://openlibrary.org/isbn/${isbn}.json`));
    const editions = await Promise.all(edition.works.map(async ({ key: work }: { key: string }) => {
      const workId = work.replace(/^\/works\//, '');
      return JSON.parse(await fetch(`https://openlibrary.org/works/${workId}/editions.json`));
    }));
    const otherISBNs = editions.flatMap((ed: { entries: Record<string, string>[] }) =>
      ed.entries.flatMap(e =>
        ['isbn_10', 'isbn_13'].filter(k => k in e).map(k => e[k])));
    return otherISBNs;
  }
  if (isbn === undefined) {
    return more;
  } else {
    return more(isbn);
  }
}
