export type Fetcher = (url: string) => Promise<string>;

export class ContentError {
  constructor(public description: string) { }
}

export interface EditionsISBNResults {
  isbns?: string[],
  workFaults: ContentError[],
  editionsFaults: ContentError[],
}

export function otherEditionsOfISBN(fetch: Fetcher, isbn: string): Promise<EditionsISBNResults>;
export function otherEditionsOfISBN(fetch: Fetcher): (isbn: string) => Promise<EditionsISBNResults>;
export function otherEditionsOfISBN(fetch: Fetcher, isbn?: string): Promise<EditionsISBNResults> | ((isbn: string) => Promise<EditionsISBNResults>) {
  async function more(isbn: string): Promise<EditionsISBNResults> {
    const response = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
    const edition = (() => {
      try { return JSON.parse(response) } catch (e) {
        throw new ContentError(`isbn/${isbn}.json response is not parseable as JSON`);
      }
    })();
    if (!isObject(edition))
      throw new ContentError(`isbn/${isbn}.json response is not an object`);

    if (!hasArrayProperty('works', edition))
      throw new ContentError(`isbn/${isbn}.json response .works is missing or not an array`);
    if (edition.works.length < 1)
      throw new ContentError(`isbn/${isbn}.json response .works is empty`);

    const workIds = edition.works.map((workObj, index) => {
      if (!isObject(workObj))
        return new ContentError(`isbn/${isbn}.json response .works[${index}] is missing or not an object`);
      if (!hasStringProperty('key', workObj))
        return new ContentError(`isbn/${isbn}.json response .works[${index}].key is missing or not a string`);

      const workKey: string = workObj.key;
      const prefix = '/works/';

      if (!workKey.startsWith(prefix))
        return new ContentError(`isbn/${isbn}.json response .works[${index}].key (${workKey}) does not start with ${prefix}`);

      return workKey.slice(prefix.length);
    });

    const { valid: validWorkIds, faults: workFaults } = workIds.reduce((partition, workId) => {
      if (isString(workId)) partition.valid.push(workId);
      else partition.faults.push(workId);
      return partition;
    }, { valid: [] as string[], faults: [] as ContentError[] });

    if (validWorkIds.length < 1)
      return {
        workFaults: [new ContentError(`isbn/${isbn}.json no valid workIds`)].concat(workFaults),
        editionsFaults: [],
      };

    const editionsResults = await Promise.all(validWorkIds.map(async workId => {
      const editions = JSON.parse(await fetch(`https://openlibrary.org/works/${workId}/editions.json`));
      if (!isObject(editions))
        return { isbns: [], faults: [new ContentError(`${workId}/editions.json response is not an object`)] };

      if (!hasArrayProperty('entries', editions))
        return { isbns: [], faults: [new ContentError(`${workId}/editions.json response .entries is missing or not an array`)] };

      let allISBNs: string[] = [];
      const faults: ContentError[] = [];
      editions.entries.forEach((entry, index) => {
        const isbns: string[] = [];
        function process<K extends string>(k: K, o: unknown) {
          if (isObject(o) && hasProperty(k, o)) {
            const v = o[k];
            if (!isString(v))
              faults.push(new ContentError(`${workId}/editions.json .entries[${index}].${k} is not a string`));
            else isbns.push(v);
          }
        }
        process('isbn_10', entry);
        process('isbn_13', entry);
        if (isbns.length < 1)
          faults.push(new ContentError(`${workId}/editions.json .entries[${index}] has neither .isbn_10 nor .isbn_13`));
        allISBNs = allISBNs.concat(isbns);
      });
      return { isbns: allISBNs, faults };
    }));
    const results: Required<EditionsISBNResults> = { isbns: [], editionsFaults: [], workFaults };
    editionsResults.forEach((editionResults) => {
      results.isbns = results.isbns.concat(editionResults.isbns);
      results.editionsFaults = results.editionsFaults.concat(editionResults.faults);
    });
    if (results.isbns.length < 1)
      return {
        isbns: [],
        workFaults,
        editionsFaults: [new ContentError(`no valid ISBNs among in all editions.jsons for all ${isbn} works`)].concat(results.editionsFaults)
      };
    return results;
  }
  if (isbn === undefined) {
    return more;
  } else {
    return more(isbn);
  }
}

function isString(value: any): value is string {
  return typeof value == 'string';
}

function hasProperty<K extends string, T>(key: K, obj: Record<K, unknown>): obj is { [k in K]: T } {
  return key in obj;
}

function hasStringProperty<K extends string>(keyString: K, obj: Record<K, unknown>): obj is { [k in K]: string } {
  return keyString in obj && typeof obj[keyString] == 'string';
}

function hasArrayProperty<K extends string, T>(keyString: K, obj: Record<K, unknown>): obj is { [k in K]: T[] } {
  return keyString in obj && obj[keyString] && Array.isArray(obj[keyString]);
}

function isObject<K extends PropertyKey, V>(maybeObject: any): maybeObject is Record<K, V> {
  return maybeObject && typeof maybeObject == 'object';
}
