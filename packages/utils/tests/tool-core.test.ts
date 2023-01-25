import { describe, test, expect, jest, afterEach } from '@jest/globals';
import { outdent } from 'outdent';
import { AllEditionsServices, CacheControl, EditionsService, equivalentISBNs, Fetcher, getISBNs, missingISBNs, normalizeISBN, ProgressReport, Row } from 'utils';

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

describe('getISBNs', () => {

  test('not really CSV', async () => {
    const csv = outdent`
      This is just a string. It is
      not particularly CSV-like, but it
      might be interpreted like that.
    `;

    await expect(getISBNs(csv, 'to-read')).rejects.toBeDefined();
  });

  test('no Bookshelves columns', async () => {
    const csv = outdent`
      id,ISBN13
      100,100000
    `;

    await expect(getISBNs(csv, 'to-read')).rejects.toBeDefined();
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
    const result = await getISBNs(csv, 'to-read');

    // missing column is same as empty
    expect(result).toStrictEqual(new Set);
  });

  test('no options: first of ISBN13 or ISBN', async () => {
    const csv = outdent`
      id,Bookshelves,ISBN,ISBN13
      200,to-read,"=""0000002003""",
      101,read,,
      102,currently-reading,,
      103,"read, other",,
      204,"third, to-read","=""""","=""9780000002044"""
      205,to-read,0000002054,9780000002051
    `;
    const result = await getISBNs(csv, 'to-read');

    expect(result).toStrictEqual(new Set(['0000002003', '9780000002044', '9780000002051']));
  });

  test('no options: first of ISBN13 or ISBN (other shelf)', async () => {
    const csv = outdent`
      id,Bookshelves,ISBN,ISBN13
      100,to-read,"=""0000001007""",
      101,read,,
      102,currently-reading,,
      203,"read, other","=""0000002038""",9780000002037
      104,"third, to-read","=""""","=""9780000001047"""
      105,to-read,"=""0000001058""",9780000001054
    `;
    const result = await getISBNs(csv, 'other');

    expect(result).toStrictEqual(new Set(['9780000002037']));
  });

  test('{bothISBNs:true}: ISBN-13 and ISBN-10 of first of ISBN13 or ISBN', async () => {
    const csv = outdent`
      id,Bookshelves,ISBN,ISBN13
      200,to-read,"=""0000002003""",
      101,read,,
      102,currently-reading,,
      103,"read, other",,
      204,"third, to-read","=""""","=""9780000002044"""
      205,to-read,0000002054,9780000002051
      206,to-read,000000206Y,9780000002068
    `;
    // 206 ISBN is bogus, but it is ignored since it also has ISBN13

    const result = await getISBNs(csv, 'to-read', { bothISBNs: true });

    // 206's ISBN-10 will be derived from its ISBN13
    expect(result).toStrictEqual(new Set([
      '0000002003', '9780000002006',
      '0000002046', '9780000002044',
      '0000002054', '9780000002051',
      '0000002062', '9780000002068',
    ]));
  });

  test('{otherEditions:{fetcher:<resolves to empty string>}}', async () => {
    const csv = outdent`
      id,Bookshelves,ISBN,ISBN13
      200,to-read,"=""0000002003""",
      101,read,,
      102,currently-reading,,
      103,"read, other",,
      204,"third, to-read","=""""","=""9780000002044"""
      205,to-read,0000002054,9780000002051
      206,to-read,000000206Y,9780000002068
    `;
    // 206 ISBN is bogus, but it is ignored since it also has ISBN13

    const fetcher = jest.fn<Fetcher>().mockResolvedValue('');
    const result = await getISBNs(csv, 'to-read', { otherEditions: { fetcher, throttle: false } });

    // ISBN-13 version of first of ISBN13 or ISBN
    expect(result).toStrictEqual(new Set([
      '9780000002006',
      '9780000002044',
      '9780000002051',
      '9780000002068',
    ]));
  });

  test('{otherEditions:{fetcher:<simulates each service>}}', async () => {
    const csv = outdent`
      id,Bookshelves,ISBN,ISBN13
      200,to-read,"=""0000002003""",
      101,read,,
      102,currently-reading,,
      103,"read, other",,
      204,"third, to-read","=""""","=""9780000002044"""
      205,to-read,0000002054,9780000002051
      206,to-read,000000206Y,9780000002068
    `;

    const fetcher = makeFakeFetcher({
      '9780000002006': ['0-00-010200-8'],
      '9780000002044': ['978-0-00-010204-1', '0000202045'],
      '9780000002051': ['9780000102058', '9780000202055', '978-0 00-030205 2'],
      '9780000002068': [],
    });
    const result = await getISBNs(csv, 'to-read', { otherEditions: { fetcher, throttle: false } });

    // ISBN-13 version of "editions of" first of ISBN13 or ISBN
    expect(result).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055', '9780000302052',
      '9780000002068',
    ]));
  });

  test('{bothISBNs:true,otherEditions:{fetcher:<simulates all services>}}', async () => {
    const csv = outdent`
      id,Bookshelves,ISBN,ISBN13
      200,to-read,"=""0000002003""",
      101,read,,
      102,currently-reading,,
      103,"read, other",,
      204,"third, to-read","=""""","=""9780000002044"""
      205,to-read,0000002054,9780000002051
      206,to-read,000000206Y,9780000002068
    `;

    const fetcher = makeFakeFetcher({
      '9780000002006': ['0-00-010200-8'],
      '9780000002044': ['978-0-00-010204-1', '0000202045'],
      '9780000002051': ['9780000102058', '9780000202055', '978-0 00-030205 2'],
      '9780000002068': [],
    });
    const result = await getISBNs(csv, 'to-read', { bothISBNs: true, otherEditions: { fetcher, throttle: false } });

    // ISBN-13 and ISBN-10 versions of "editions of" first of ISBN13 or ISBN
    expect(result).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '0000002003', '0000102008',

      '9780000002044', '9780000102041', '9780000202048',
      '0000002046', '0000102040', '0000202045',

      '9780000002051', '9780000102058', '9780000202055', '9780000302052',
      '0000002054', '0000102059', '0000202053', '0000302058',

      '9780000002068',
      '0000002062',
    ]));
  });

  test.each(Array.from(AllEditionsServices))('{otherEditions:{services:{%s},fetcher:<simulates all services>}}', async service => {
    const csv = outdent`
      id,Bookshelves,ISBN,ISBN13
      200,to-read,"=""0000002003""",
      101,read,,
      102,currently-reading,,
      103,"read, other",,
      204,"third, to-read","=""""","=""9780000002044"""
      205,to-read,0000002054,9780000002051
      206,to-read,000000206Y,9780000002068
    `;

    const fetcher = makeFakeFetcher({
      '9780000002006': ['0-00-010200-8'],
      '9780000002044': ['978-0-00-010204-1', '0000202045'],
      '9780000002051': ['9780000102058', '9780000202055', '978-0 00-030205 2'],
      '9780000002068': [],
    });
    const serviceSpy = jest.fn();
    const result = await getISBNs(csv, 'to-read', {
      otherEditions: {
        services: new Set([service]),
        fetcher,
        reporter,
        throttle: false,
      }
    });

    // ISBN-13 version of "editions of" first of ISBN13 or ISBN
    expect(result).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055', '9780000302052',
      '9780000002068',
    ]));

    expect(serviceSpy.mock.calls).toEqual(Array(9).fill([service]));

    function reporter(report: ProgressReport) {
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
  });

  test('{otherEditions:{services:{multiple},fetcher:<simulates all services>}} merges result across services', async () => {
    const csv = outdent`
      id,Bookshelves,ISBN,ISBN13
      200,to-read,"=""0000002003""",
      101,read,,
      102,currently-reading,,
      103,"read, other",,
      204,"third, to-read","=""""","=""9780000002044"""
      205,to-read,0000002054,9780000002051
      206,to-read,000000206Y,9780000002068
    `;
    const serviceSpy = jest.fn();
    const cacheData: Record<string, unknown> = {};

    // fetch some "editions of" ISBNs with one service
    expect(await getISBNs(csv, 'to-read', {
      otherEditions: {
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
      }
    })).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041',
      '9780000002051', '9780000102058', '9780000202055',
      '9780000002068',
    ]));
    expect(serviceSpy.mock.calls).toEqual(Array(9).fill(['Open Library WorkEditions']));

    serviceSpy.mockClear();

    // fetch some slightly different "editions of" ISBNs with another service
    expect(await getISBNs(csv, 'to-read', {
      otherEditions: {
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
      }
    })).toStrictEqual(new Set([
      '9780000002006',
      '9780000002044', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055',
      '9780000002068', '9780000102065'
    ]));
    expect(serviceSpy.mock.calls).toEqual(Array(9).fill(['LibraryThing ThingISBN']));

    serviceSpy.mockClear();

    // now, enable both services and fetch the merged ISBNs
    expect(await getISBNs(csv, 'to-read', {
      otherEditions: {
        services: new Set(['Open Library WorkEditions', 'LibraryThing ThingISBN']),
        fetcher: () => { throw 'everything should have been cached!' },
        cacheData,
        reporter,
      }
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
      const result = await getISBNs(csv, 'to-read', {
        otherEditions: {
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
        }
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

    function reporter(report: ProgressReport) {
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
  });
});

describe('getISBNs fake timers', () => {
  afterEach(() => void jest.useRealTimers());

  test('fetcher can specify cache duration for not-ok results', async () => {
    const csv = outdent`
      id,Bookshelves,ISBN,ISBN13
      200,to-read,"=""0000002003""",
      101,read,,
      102,currently-reading,,
      103,"read, other",,
      204,"third, to-read","=""""","=""9780000002044"""
      205,to-read,0000002054,9780000002051
      206,to-read,000000206Y,9780000002068
    `;

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
    const serviceSpy = jest.fn();

    expect(await getISBNs(csv, 'to-read', {
      otherEditions: {
        fetcher, services, cacheData, reporter,
        throttle: false,
      }
    })).toStrictEqual(new Set([
      '9780000002006',
      '9780000002044',
      '9780000002051',
      '9780000002068',
    ]));
    expect(serviceSpy).toHaveBeenCalledTimes(9); // plan + 4 * (start + finish)

    jest.setSystemTime(okAfter - 1000);
    serviceSpy.mockClear();

    expect(await getISBNs(csv, 'to-read', {
      otherEditions: {
        fetcher, services, cacheData, reporter,
        throttle: false,
      }
    })).toStrictEqual(new Set([
      '9780000002006',
      '9780000002044',
      '9780000002051',
      '9780000002068',
    ]));
    expect(serviceSpy).toHaveBeenCalledTimes(4); // 4 * cache hit

    jest.setSystemTime(okAfter + 1000);
    serviceSpy.mockClear();

    expect(await getISBNs(csv, 'to-read', {
      otherEditions: {
        fetcher, services, cacheData, reporter,
        throttle: false,
      }
    })).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055', '9780000302052',
      '9780000002068',
    ]));
    expect(serviceSpy).toHaveBeenCalledTimes(9); // plan + 4 * (start + finish)

    function reporter(report: ProgressReport) {
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
  });

  test.each(Array.from(AllEditionsServices))('%s fetcher can specify duration for ok results', async service => {
    const csv = outdent`
    id,Bookshelves,ISBN,ISBN13
    200,to-read,"=""0000002003""",
    101,read,,
    102,currently-reading,,
    103,"read, other",,
    204,"third, to-read","=""""","=""9780000002044"""
    205,to-read,0000002054,9780000002051
    206,to-read,000000206Y,9780000002068
  `;

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
        const r = new CacheControl(response, { until });
        return r;
      }
      else
        return await baseFetcher(url);
    };
    const services = new Set([service]);
    const cacheData: Record<string, unknown> = {};
    const serviceSpy = jest.fn();

    expect(await getISBNs(csv, 'to-read', {
      otherEditions: {
        fetcher, services, cacheData, reporter,
        throttle: false,
      }
    })).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055', '9780000302052',
      '9780000002068',
    ]));
    expect(serviceSpy).toHaveBeenCalledTimes(9); // plan + 4 * (start + finish)

    jest.setSystemTime(earlyExpire - 1000);
    serviceSpy.mockClear();

    expect(await getISBNs(csv, 'to-read', {
      otherEditions: {
        fetcher, services, cacheData, reporter,
        throttle: false,
      }
    })).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055', '9780000302052',
      '9780000002068',
    ]));
    expect(serviceSpy).toHaveBeenCalledTimes(4); // 4 * cache hit

    jest.setSystemTime(earlyExpire + 1000);
    serviceSpy.mockClear();

    expect(await getISBNs(csv, 'to-read', {
      otherEditions: {
        fetcher, services, cacheData, reporter,
        throttle: false,
      }
    })).toStrictEqual(new Set([
      '9780000002006', '9780000102003',
      '9780000002044', '9780000102041', '9780000202048',
      '9780000002051', '9780000102058', '9780000202055', '9780000302052',
      '9780000002068',
    ]));
    expect(serviceSpy).toHaveBeenCalledTimes(7); // 2 * cache hit + plan + 2 * (start + finish)

    function reporter(report: ProgressReport) {
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
