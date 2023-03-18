import { describe, test, expect, jest, afterEach } from '@jest/globals';
import { outdent } from 'outdent';
import { AllEditionsServices, bothISBNsOf, CacheControl, type EditionsService, equivalentISBNs, type Fetcher, getEditionsOf, normalizeISBN, parseCSVRows, type ProgressReport, type Row, guessFormat, GoodreadsFormat, LibraryThingFormat, type ProgressReporter } from 'utils';

describe('guessFormat', () => {
  test('detect GR and LT by column names', () => {

    expect(() => guessFormat([fakeColumns([
      'Book Id', 'Title', 'Author', /*'Exclusive Shelf',*/ 'Bookshelves', 'ISBN', 'ISBN13',
    ])])).toThrow();
    expect(() => guessFormat([fakeColumns([
      'Book Id', 'Title', 'Primary Author', /*'Collections',*/ 'Tags', 'ISBN', 'ISBNs',
    ])])).toThrow();

    expect(guessFormat([fakeColumns(['Book Id', 'Title', 'Author', 'Exclusive Shelf', 'Bookshelves', 'ISBN', 'ISBN13'])])).toBe(GoodreadsFormat);
    expect(guessFormat([fakeColumns(['Book Id', 'Title', 'Author', 'Exclusive Shelf', 'Bookshelves', 'ISBN', 'ISBN13', 'Extra'])])).toBe(GoodreadsFormat);
    expect(guessFormat([fakeColumns([
      'Book Id', 'Title', 'Author', 'Exclusive Shelf', 'Bookshelves', 'ISBN', 'ISBN13',
      'Primary Author', 'Collections', 'Tags', /*'ISBNS',*/])])).toBe(GoodreadsFormat);

    expect(guessFormat([fakeColumns(['Book Id', 'Title', 'Primary Author', 'Collections', 'Tags', 'ISBN', 'ISBNs'])])).toBe(LibraryThingFormat);
    expect(guessFormat([fakeColumns(['Book Id', 'Title', 'Primary Author', 'Collections', 'Tags', 'ISBN', 'ISBNs', 'Extra'])])).toBe(LibraryThingFormat);
    expect(guessFormat([fakeColumns([
      'Book Id', 'Title', 'Primary Author', 'Collections', 'Tags', 'ISBN', 'ISBNs',
      'Author', /*'Exclusive Shelf',*/ 'Bookshelves', 'ISBN', 'ISBN13',
    ])])).toBe(LibraryThingFormat);

    expect(guessFormat([fakeColumns([
      'Book Id', 'Title', 'Primary Author', 'Collections', 'Tags', 'ISBN', 'ISBNs',
      'Book Id', 'Title', 'Author', 'Exclusive Shelf', 'Bookshelves', 'ISBN', 'ISBN13',
    ])])).toBe(GoodreadsFormat);

    function fakeColumns(columns: string[]) {
      return Object.fromEntries(columns.map(c => [c, '']));
    }
  });
});

describe('format.groupInfo', () => {
  test('no Bookshelves/Collections/Tags columns', async () => {
    const rows = await parseCSVRows(outdent`
      id,ISBN13
      100,100000
      101,
      102,"="""""
      103,103000
      104,"=""104000"""
      105,105000
    `);

    expect(GoodreadsFormat.groupInfo(rows)).toStrictEqual(new Map);
    expect(LibraryThingFormat.groupInfo(rows)).toStrictEqual(new Map);
  });

  test('GR: no Exclusive Shelf column', async () => {
    const rows = await parseCSVRows(outdent`
      id,Bookshelves
      100,to-read
      101,read
      102,"did-not-finish, library"
      103,library
      104,"kindle,to-read"
      105,currently-reading
    `);

    expect(GoodreadsFormat.groupInfo(rows)).toStrictEqual(new Map([['Shelf', new Map([
      ['to-read', 2],
      ['read', 1],
      ['did-not-finish', 1],
      ['library', 2],
      ['kindle', 1],
      ['currently-reading', 1]
    ])]]));
  });

  test('GR: no read only in Exclusive Shelf columns', async () => {
    const rows = await parseCSVRows(outdent`
      id,Bookshelves,Exclusive Shelf
      100,to-read,to-read
      101,,read
      102,"did-not-finish, library",did-not-finish
      103,library,read
      104,"kindle,to-read",to-read
      105,currently-reading,currently-reading
    `);

    expect(GoodreadsFormat.groupInfo(rows)).toStrictEqual(new Map([['Shelf', new Map([
      ['to-read', 2],
      ['read', 2],
      ['did-not-finish', 1],
      ['library', 2],
      ['kindle', 1],
      ['currently-reading', 1]
    ])]]));
  });

  test('LT: Collections and Tags', async () => {
    const rows = await parseCSVRows(outdent`
      id	Collections	Tags
      100	To be read
      101	Read but unowned
      102	DNF	library
      103		library
      104	To be read	kindle
      105	Currently reading
    `);

    expect(LibraryThingFormat.groupInfo(rows)).toStrictEqual(new Map([
      ['Collection', new Map([
        ['To be read', 2],
        ['Read but unowned', 1],
        ['DNF', 1],
        ['Currently reading', 1]
      ])],
      ['Tag', new Map([
        ['library', 2],
        ['kindle', 1],
      ])],
    ]));
  });
});

function ids(rows: Row[]): number[] {
  return rows.map(row => parseInt(row.id ?? '-1'));
}

describe('format.rowsInGroup', () => {
  test('no Bookshelves/Collections/Tags columns', () => {
    const rows = [
      { id: '1' },
      { id: '2' },
    ];

    expect(GoodreadsFormat.rowsInGroup(rows, '', '')).toStrictEqual([]);
    expect(LibraryThingFormat.rowsInGroup(rows, '', '')).toStrictEqual([]);
  });

  test('GR: match from Bookshelves', () => {
    const rows = [
      { id: '1', Bookshelves: '' },
      { id: '2', Bookshelves: 'shelf' },
      { id: '3', Bookshelves: 'shelf 1' },
      { id: '4', Bookshelves: 'shelf 1,shelf 2' },
      { id: '5', Bookshelves: 'shelf 1, shelf 2' },
      { id: '6', Bookshelves: 'shelf 1, shelf 2 , shelf 3' },
    ];
    const rowsInGroup = GoodreadsFormat.rowsInGroup;

    expect(rowsInGroup(rows, 'Shelf', '')).toStrictEqual([]);
    expect(ids(rowsInGroup(rows, 'Shelf', 'shelf'))).toStrictEqual([2]);
    expect(ids(rowsInGroup(rows, 'Shelf', 'shelf 1'))).toStrictEqual([3, 4, 5, 6]);
    expect(ids(rowsInGroup(rows, 'Shelf', 'shelf 2'))).toStrictEqual([4, 5, 6]);
    expect(ids(rowsInGroup(rows, 'Shelf', 'shelf 3'))).toStrictEqual([6]);
  });

  test('GR: match from Exclusive Shelf', () => {
    // not sure why (brevity?), but Goodreads exports don't include `read` in
    // Bookshelves, just in Exclusive Shelf
    const rows = [
      { id: '1', 'Exclusive Shelf': '', Bookshelves: '' },
      { id: '2', 'Exclusive Shelf': '', Bookshelves: 'shelf' },
      { id: '3', 'Exclusive Shelf': 'read', Bookshelves: 'shelf 1' },
      { id: '4', 'Exclusive Shelf': 'to-read', Bookshelves: 'to-read,shelf 1,shelf 2' },
      { id: '5', 'Exclusive Shelf': 'read', Bookshelves: 'shelf 1, shelf 2' },
      { id: '6', 'Exclusive Shelf': '', Bookshelves: 'shelf 1, shelf 2 , shelf 3' },
    ];
    const rowsInGroup = GoodreadsFormat.rowsInGroup;

    expect(rowsInGroup(rows, 'Shelf', '')).toStrictEqual([]);
    expect(ids(rowsInGroup(rows, 'Shelf', 'shelf'))).toStrictEqual([2]);
    expect(ids(rowsInGroup(rows, 'Shelf', 'shelf 1'))).toStrictEqual([3, 4, 5, 6]);
    expect(ids(rowsInGroup(rows, 'Shelf', 'shelf 2'))).toStrictEqual([4, 5, 6]);
    expect(ids(rowsInGroup(rows, 'Shelf', 'shelf 3'))).toStrictEqual([6]);

    expect(ids(rowsInGroup(rows, 'Shelf', 'read'))).toStrictEqual([3, 5]);
    expect(ids(rowsInGroup(rows, 'Shelf', 'to-read'))).toStrictEqual([4]);
  });

  test('LT: match from Collections', () => {
    const rows = [
      { id: '1', 'Collections': 'Mystery' },
      { id: '2', 'Collections': '' },
      { id: '3', 'Collections': 'Read but unowned, Mystery' },
      { id: '4', 'Collections': 'To be read' },
      { id: '5', 'Collections': 'Read but unowned' },
      { id: '6', 'Collections': '' },
    ];
    const rowsInGroup = LibraryThingFormat.rowsInGroup;

    expect(rowsInGroup(rows, 'Collection', '')).toStrictEqual([]);
    expect(ids(rowsInGroup(rows, 'Collection', 'Mystery'))).toStrictEqual([1, 3]);
    expect(ids(rowsInGroup(rows, 'Collection', 'Read but unowned'))).toStrictEqual([3, 5]);
    expect(ids(rowsInGroup(rows, 'Collection', 'To be read'))).toStrictEqual([4]);
  });

  test('LT: match from Tags', () => {
    const rows = [
      { id: '1', Tags: '' },
      { id: '2', Tags: 'shelf' },
      { id: '3', Tags: 'shelf 1' },
      { id: '4', Tags: 'shelf 1,shelf 2' },
      { id: '5', Tags: 'shelf 1, shelf 2' },
      { id: '6', Tags: 'shelf 1, shelf 2 , shelf 3' },
    ];
    const rowsInGroup = LibraryThingFormat.rowsInGroup;

    expect(rowsInGroup(rows, 'Tag', '')).toStrictEqual([]);
    expect(ids(rowsInGroup(rows, 'Tag', 'shelf'))).toStrictEqual([2]);
    expect(ids(rowsInGroup(rows, 'Tag', 'shelf 1'))).toStrictEqual([3, 4, 5, 6]);
    expect(ids(rowsInGroup(rows, 'Tag', 'shelf 2'))).toStrictEqual([4, 5, 6]);
    expect(ids(rowsInGroup(rows, 'Tag', 'shelf 3'))).toStrictEqual([6]);
  });
});

describe('format.missingAndISBNs', () => {
  test('GR: missing, empty ISBN13/ISBN, quoted ISBN13/ISBN', () => {
    const rows = [
      { id: '1', },
      { id: '2', ISBN13: '' },
      { id: '3', ISBN: '' },
      { id: '4', ISBN13: '', ISBN: '' },
      { id: '5', ISBN13: '9780000005007' },
      { id: '6', ISBN: '0000006009' },
      { id: '7', ISBN13: '978 000000700 1', ISBN: '0 000007005' },
      { id: '8', ISBN13: '="978000000800-8"' },
      { id: '9', ISBN: '="0 000009008"' },
      { id: 'A', ISBN13: '="978 0000010001"', ISBN: '="0 0000-1000 6"' },
    ];

    const r = GoodreadsFormat.missingAndISBNs(rows);

    expect(ids(r.missingISBN)).toStrictEqual([1, 2, 3, 4]);
    expect(r.isbns).toStrictEqual(new Set([
      '9780000005007',
      '9780000006004',
      '9780000007001',
      '9780000008008',
      '9780000009005',
      '9780000010001',
    ]));
  });

  test('LT: missing, empty ISBN/ISBNS, quoted empty ISBN, quoted ISBN', () => {
    const rows = [
      { id: '1', },
      { id: '2', ISBN: '' },
      { id: '3', ISBN: '[]' },
      { id: '4', ISBNS: '' },
      { id: '5', ISBN: '', ISBNS: '' },
      { id: '6', ISBN: '[]', ISBNS: '' },
      { id: '7', ISBN: '9780000007001' },
      { id: '8', ISBNS: '0000008001,9780000008008' },
      { id: '9', ISBN: '978 000000900 5', ISBNS: '978 000000900 5 , 0 000009008' },
      { id: 'A', ISBN: '[978000001000-1]' },
      { id: 'B', ISBN: '[0 000011002]', ISBNS: '0 000011002,9780000011008' },
      { id: 'C', ISBN: '[]', ISBNS: '978 0000012005,0 0000-1200 9' },
    ];

    const r = LibraryThingFormat.missingAndISBNs(rows);

    expect(ids(r.missingISBN)).toStrictEqual([1, 2, 3, 4, 5, 6]);
    expect(r.isbns).toStrictEqual(new Set([
      '9780000007001',
      '9780000008008',
      '9780000009005',
      '9780000010001',
      '9780000011008',
      '9780000012005',
    ]));
  });
});

function makeFakeFetcher(data: Record<string, string[]>): Fetcher {
  return async url => {
    let match;

    match = url.match(RegExp('^https://openlibrary\\.org/isbn/([\\dXx -]+)\\.json$'));
    if (match)
      return JSON.stringify({ works: [{ key: `/works/OL${match[1]}W` }] }); // fake work ID
    match = url.match(RegExp('^https://openlibrary\\.org/works/OL([\\dXx -]+)W/editions\\.json$'));
    if (match)
      return JSON.stringify({ entries: (data[equivalentISBNs(match[1])[0]] ?? []).map(isbn => normalizeISBN(isbn).length == 13 ? { isbn_13: [isbn] } : { isbn_10: [isbn] }) });

    match = url.match(RegExp('^https://openlibrary\\.org/search\\.json\\?q=([\\dXx -]+)&fields=isbn$'));
    if (match)
      return JSON.stringify({ docs: [{ isbn: (data[equivalentISBNs(match[1])[0]] ?? []) }] });

    match = url.match(RegExp('^https://www\\.librarything\\.com/api/thingISBN/([\\dXx -]+)$'));
    if (match)
      return `<idlist>${(data[equivalentISBNs(match[1])[0]] ?? []).map(isbn => `<isbn>${isbn}</isbn>`).join('')}</idlist>`;

    throw 'nope: ' + url;
  };
}

function makeServiceSpyReporter(): { serviceSpy: jest.Mock<(service: EditionsService) => void>, reporter: ProgressReporter } {
  const serviceSpy = jest.fn();
  return {
    serviceSpy: serviceSpy,
    reporter: report => {
      const event = report.event;
      if (event == 'query plan')
        Array.from(report.plan.keys()).forEach(service => serviceSpy(service));
      if (event == 'service cache hit')
        serviceSpy(report.service);
      if (event == 'service query started')
        serviceSpy(report.service);
      if (event == 'service query finished')
        serviceSpy(report.service);
    }
  };
}

describe('getEditionsOf', () => {
  test('rejecting or empty fetcher', async () => {
    const rejectingFetcher = jest.fn<Fetcher>().mockRejectedValue(void 0);
    const emptyFetcher = jest.fn<Fetcher>().mockResolvedValue('');

    await expect(getEditionsOf([], { fetcher: rejectingFetcher }))
      .resolves.toStrictEqual(new Set([]));
    expect(rejectingFetcher).toHaveBeenCalledTimes(0);

    await expect(getEditionsOf(['1234'], { fetcher: rejectingFetcher }))
      .resolves.toStrictEqual(new Set(['1234']));
    expect(rejectingFetcher).toHaveBeenCalledTimes(1);

    await expect(getEditionsOf(['2345', '0000002054', '9780000002068'], { fetcher: emptyFetcher, throttle: false }))
      .resolves.toStrictEqual(new Set(['2345', '9780000002051', '9780000002068']));
    expect(emptyFetcher).toHaveBeenCalledTimes(3);
  });

  test('fetcher:<simulates all services>', async () => {
    const fetcher = makeFakeFetcher({
      '9780000002006': ['0-00-010200-8'],
      '9780000002044': ['978-0-00-010204-1', '0000202045'],
      '9780000002051': ['9780000102058', '9780000202055', '978-0 00-030205 2'],
      '9780000002068': [],
    });

    const result = await getEditionsOf([
      '0000002003', '9780000002044', '9780000002051', '9780000002068'
    ], { fetcher, throttle: false });

    // ISBN-13 version of "editions of"
    expect(result).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055', '9780000302052',
      '9780000002068',
    ]));
  });

  test.each(Array.from(AllEditionsServices))('services:{%s}, fetcher:<simulates all services>', async service => {
    const fetcher = makeFakeFetcher({
      '9780000002006': ['0-00-010200-8'],
      '9780000002044': ['978-0-00-010204-1', '0000202045'],
      '9780000002051': ['9780000102058', '9780000202055', '978-0 00-030205 2'],
      '9780000002068': [],
    });
    const { serviceSpy, reporter } = makeServiceSpyReporter();

    const result = await getEditionsOf([
      '0000002003', '9780000002044', '9780000002051', '9780000002068'
    ], {
      services: new Set([service]),
      fetcher,
      reporter,
      throttle: false,
    });

    // ISBN-13 version of "editions of"
    expect(result).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055', '9780000302052',
      '9780000002068',
    ]));
    expect(serviceSpy.mock.calls).toEqual(Array(9).fill([service]));
  });

  test('{otherEditions:{services:{multiple},fetcher:<simulates all services>}} merges result across services', async () => {
    const { serviceSpy, reporter } = makeServiceSpyReporter();
    const cacheData: Record<string, unknown> = {};
    const isbns = [
      '0000002003',
      '9780000002044',
      '9780000002051',
      '9780000002068',
    ];

    // fetch some "editions of" ISBNs with one service
    expect(await getEditionsOf(isbns, {
      services: new Set(['Open Library WorkEditions']),
      fetcher: makeFakeFetcher({
        '9780000002006': ['0-00-010200-8'],
        '9780000002044': ['978-0-00-010204-1'],
        '9780000002051': ['9780000102058', '9780000202055'],
        '9780000002068': [],
      }),
      cacheData,
      reporter,
      throttle: false,
    })).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041',
      '9780000002051', '9780000102058', '9780000202055',
      '9780000002068',
    ]));
    expect(serviceSpy.mock.calls).toEqual(Array(9).fill(['Open Library WorkEditions']));

    serviceSpy.mockClear();

    // fetch some slightly different "editions of" ISBNs with another service
    expect(await getEditionsOf(isbns, {
      services: new Set(['LibraryThing ThingISBN']),
      fetcher: makeFakeFetcher({
        '9780000002006': [],
        '9780000002044': ['0000202045'],
        '9780000002051': ['9780000102058', '9780000202055'],
        '9780000002068': ['0-00-010206-7'],
      }),
      cacheData,
      reporter,
      throttle: false,
    })).toStrictEqual(new Set([
      '9780000002006',
      '9780000002044', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055',
      '9780000002068', '9780000102065'
    ]));
    expect(serviceSpy.mock.calls).toEqual(Array(9).fill(['LibraryThing ThingISBN']));

    serviceSpy.mockClear();

    // now, enable both services and fetch the merged ISBNs
    expect(await getEditionsOf(isbns, {
      services: new Set(['Open Library WorkEditions', 'LibraryThing ThingISBN']),
      fetcher: () => { throw 'everything should have been cached!' },
      cacheData,
      reporter,
    })).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055',
      '9780000002068', '9780000102065'
    ]));
    expect(serviceSpy).toHaveBeenCalledTimes(4); // 4 cache hits, probably both services

    serviceSpy.mockClear();

    const primedCacheData = JSON.stringify(cacheData);

    // also merge after a live query, not just cache hits on assigned services

    // this is pretty ugly... ISBNs are randomly assigned to services, so we
    // can't guarantee that the target ISBN will be processed by the pristine
    // service. Try a bunch of times and hope we get the desired assignment
    // eventually
    let valid = false;
    for (let i = 0; i < 30; i++) {
      const result = await getEditionsOf(isbns, {
        services: AllEditionsServices,
        fetcher: makeFakeFetcher({
          '9780000002006': [],
          '9780000002044': [],
          '9780000002051': ['978-0 00-030205 2'],
          '9780000002068': [],
        }),
        cacheData: JSON.parse(primedCacheData),
        reporter: report => {
          if (report.event == 'service query started' && report.service == 'Open Library Search' && report.isbn == '9780000002051')
            valid = true;
        },
        throttle: false,
      });
      if (!valid) continue;

      expect(result).toStrictEqual(new Set([
        '9780000002006', '9780000102003',
        '9780000002044', '9780000102041', '9780000202048',
        '9780000002051', '9780000102058', '9780000202055', '9780000302052',
        '9780000002068', '9780000102065'
      ]));

      break;
    }

    expect(valid).toBeTruthy();
  });

  test('fetches mostly throw', async () => {
    const isbns = [
      '9780000002006',
      '9780000002013',
      '9780000002020',
      '9780000002037',
      '9780000002044',
      '9780000002051',
      '9780000002068',
      '9780000002075',
      '9780000002082',
      '9780000002099',
      '9780000002105',
      '9780000002112',
      '9780000002129',
      '9780000002136',
    ];

    const baseFetcher = makeFakeFetcher({
      '9780000002006': ['9780000102003'],
      '9780000002013': ['9780000102010'],
      '9780000002020': ['9780000102027'],
      '9780000002037': ['9780000102034'],
      '9780000002044': ['9780000102041'],
      '9780000002051': ['9780000102058'],
      '9780000002068': ['9780000102065'],
      '9780000002075': ['9780000102072'],
      '9780000002082': ['9780000102089'],
      '9780000002099': ['9780000102096'],
      '9780000002105': ['9780000102102'],
      '9780000002112': ['9780000102119'],
      '9780000002129': ['9780000102126'],
      '9780000002136': ['9780000102133'],
    });

    let fetchCount = 0;
    let abortCount = 0;
    const fetcher: Fetcher = url => {
      ++fetchCount;
      if (!(url.includes('9780000002006') || url.includes('9780000002013'))) {
        ++abortCount;
        throw `aborted ${abortCount}! fetch ${fetchCount}: ${url.replace(/^.*\//, '')}`;
      }
      return baseFetcher(url);
    };
    const services = AllEditionsServices;
    const reporter = (report: ProgressReport) => void report; // need a reporter to induce usage of beforeAndAfter internally...

    const result = getEditionsOf(isbns, {
      fetcher, services, reporter,
      throttle: false,
    });

    await expect(result).resolves.toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002013', '9780000102010',
      '9780000002020',
      '9780000002037',
      '9780000002044',
      '9780000002051',
      '9780000002068',
      '9780000002075',
      '9780000002082',
      '9780000002099',
      '9780000002105',
      '9780000002112',
      '9780000002129',
      '9780000002136',
    ]));
  });

  test('editions abort', async () => {
    const isbns = [
      '9780000002006',
      '9780000002013',
      '9780000002020',
      '9780000002037',
      '9780000002044',
      '9780000002051',
      '9780000002068',
      '9780000002075',
      '9780000002082',
      '9780000002099',
      '9780000002105',
      '9780000002112',
      '9780000002129',
      '9780000002136',
    ];

    const editions = {
      '9780000002006': ['9780000102003'],
      '9780000002013': ['9780000102010'],
      '9780000002020': ['9780000102027'],
      '9780000002037': ['9780000102034'],
      '9780000002044': ['9780000102041'],
      '9780000002051': ['9780000102058'],
      '9780000002068': ['9780000102065'],
      '9780000002075': ['9780000102072'],
      '9780000002082': ['9780000102089'],
      '9780000002099': ['9780000102096'],
      '9780000002105': ['9780000102102'],
      '9780000002112': ['9780000102119'],
      '9780000002129': ['9780000102126'],
      '9780000002136': ['9780000102133'],
    };
    const baseFetcher = makeFakeFetcher(editions);

    let fetchCount = 0;
    const fetcher: Fetcher = async url => {
      // add some slight, increasing delays to linearize things a bit
      // this keeps everything from resolving near-simultaneously before we can abort
      // we could activate the throttle instead, but that would increase test time significantly (~1s/fetch)
      await new Promise(r => setTimeout(r, 20 * ++fetchCount));
      return baseFetcher(url);
    };
    const services = AllEditionsServices;
    const finished = new Array<string>;
    let abort: () => void;
    const isbnsBeforeAborting = 10;
    const reporter = (report: ProgressReport) => {
      if (report.event == 'abort fn') {
        abort = report.fn;
      } else if (report.event == 'service query finished') {
        finished.push(report.isbn);
        report.isbns.forEach(isbn => finished.push(isbn));
        if (finished.length >= isbnsBeforeAborting) {
          // abort has to happen on a timer to let the current query's Promise chain finish resolving past the abort race
          setTimeout(abort, 0);
        }
      }
    };

    const result = await getEditionsOf(isbns, {
      fetcher, services, reporter,
      throttle: false,
    });

    expect(finished.length).toBeGreaterThanOrEqual(isbnsBeforeAborting);
    expect(finished.length).toBeLessThan(isbnsBeforeAborting * 1.75); // okay to have a few more that finish before the abort completes, but not too many

    expect(result).toStrictEqual(new Set([
      ...Object.getOwnPropertyNames(editions),
      ...finished,
    ]));
  });
});

describe('getEditionsOf caching (fake timers)', () => {

  afterEach(() => void jest.useRealTimers());

  test('fetcher can specify cache duration for not-ok results', async () => {
    const isbns = [
      '0000002003',
      '9780000002044',
      '9780000002051',
      '9780000002068',
    ];

    const baseFetcher = makeFakeFetcher({
      '9780000002006': ['0-00-010200-8'],
      '9780000002044': ['978-0-00-010204-1', '0000202045'],
      '9780000002051': ['9780000102058', '9780000202055', '978-0 00-030205 2'],
      '9780000002068': [],
    });

    jest.useFakeTimers();
    const okAfter = Date.now() + 60 * 60 * 1000;
    const fetcher: Fetcher = url => {
      if (Date.now() > okAfter)
        return baseFetcher(url);
      return Promise.resolve(new CacheControl({ status: 503, statusText: 'plz wait' }, { until: new Date(okAfter) }));
    };
    const cacheData: Record<string, unknown> = {};
    const services = new Set<EditionsService>(['LibraryThing ThingISBN']);
    const { serviceSpy, reporter } = makeServiceSpyReporter();

    expect(await getEditionsOf(isbns, {
      fetcher, services, cacheData, reporter,
      throttle: false,
    })).toStrictEqual(new Set([
      '9780000002006',
      '9780000002044',
      '9780000002051',
      '9780000002068',
    ]));
    expect(serviceSpy).toHaveBeenCalledTimes(9); // plan + 4 * (start + finish)

    jest.setSystemTime(okAfter - 1000);
    serviceSpy.mockClear();

    expect(await getEditionsOf(isbns, {
      fetcher, services, cacheData, reporter,
      throttle: false,
    })).toStrictEqual(new Set([
      '9780000002006',
      '9780000002044',
      '9780000002051',
      '9780000002068',
    ]));
    expect(serviceSpy).toHaveBeenCalledTimes(4); // 4 * cache hit

    jest.setSystemTime(okAfter + 1000);
    serviceSpy.mockClear();

    expect(await getEditionsOf(isbns, {
      fetcher, services, cacheData, reporter,
      throttle: false,
    })).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055', '9780000302052',
      '9780000002068',
    ]));
    expect(serviceSpy).toHaveBeenCalledTimes(9); // plan + 4 * (start + finish)
  });

  test.each(Array.from(AllEditionsServices))('%s fetcher can specify duration for ok results', async service => {
    const isbns = [
      '0000002003',
      '9780000002044',
      '9780000002051',
      '9780000002068',
    ];

    const baseFetcher = makeFakeFetcher({
      '9780000002006': ['0-00-010200-8'],
      '9780000002044': ['978-0-00-010204-1', '0000202045'],
      '9780000002051': ['9780000102058', '9780000202055', '978-0 00-030205 2'],
      '9780000002068': [],
    });

    jest.useFakeTimers();
    const earlyExpire = Date.now() + 60 * 60 * 1000;
    const lateExpire = Date.now() + 2 * 60 * 60 * 1000;
    const fetcher: Fetcher = async url => {
      if (/00020[45]\d/.test(url)) {
        const until = (url => {
          if (/000204\d/.test(url) && RegExp('/isbn/').test(url))
            return lateExpire;
          else if (/000205\d/.test(url) && RegExp('/editions\\.json').test(url))
            return lateExpire;
          return earlyExpire;
        })(url);
        const response = await baseFetcher(url);
        if (response instanceof CacheControl)
          throw 'program error: base fetcher gave a CacheControl response';
        const r = new CacheControl(response, { until: new Date(until) });
        return r;
      }
      else
        return await baseFetcher(url);
    };
    const services = new Set([service]);
    const cacheData: Record<string, unknown> = {};
    const { serviceSpy, reporter } = makeServiceSpyReporter();

    expect(await getEditionsOf(isbns, {
      fetcher, services, cacheData, reporter,
      throttle: false,
    })).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055', '9780000302052',
      '9780000002068',
    ]));
    expect(serviceSpy).toHaveBeenCalledTimes(9); // plan + 4 * (start + finish)

    jest.setSystemTime(earlyExpire - 1000);
    serviceSpy.mockClear();

    expect(await getEditionsOf(isbns, {
      fetcher, services, cacheData, reporter,
      throttle: false,
    })).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055', '9780000302052',
      '9780000002068',
    ]));
    expect(serviceSpy).toHaveBeenCalledTimes(4); // 4 * cache hit

    jest.setSystemTime(earlyExpire + 1000);
    serviceSpy.mockClear();

    expect(await getEditionsOf(isbns, {
      fetcher, services, cacheData, reporter,
      throttle: false,
    })).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055', '9780000302052',
      '9780000002068',
    ]));
    expect(serviceSpy).toHaveBeenCalledTimes(7); // 2 * cache hit + plan + 2 * (start + finish)
  });
});

describe('bothISBNsOf', () => {
  test('core functionality', async () => {
    const isbns = [
      '1234',
      '0000002003',
      '9780000002044',
      '0-0000 0205-4',
      '978-0000-00206-8',
    ];

    expect(bothISBNsOf(isbns)).toStrictEqual(new Set([
      '1234',
      '0000002003', '9780000002006',
      '0000002046', '9780000002044',
      '0000002054', '9780000002051',
      '0000002062', '9780000002068',
    ]));
  });
});
