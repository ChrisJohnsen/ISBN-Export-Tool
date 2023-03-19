import { describe, test, expect } from '@jest/globals';

import { groupFromName } from '../src/utils.js';

describe('groupFromName', () => {
  test('single kind', () => {
    const info = new Map([
      ['Shelf',
        new Map([
          ['to-read', 0], ['read', 0], ['currently-reading', 0], ['did-not-finish', 0],
          ['kindle', 0], ['library', 0],
        ])
      ],
    ]);

    expect(groupFromName('to-read', info)).toStrictEqual({ status: 'single', group: { kind: 'Shelf', name: 'to-read' } });
    expect(groupFromName('whoops', info)).toStrictEqual({ status: 'not found' });
  });

  test('two kinds, no collisions', () => {
    const info = new Map([
      ['Collection',
        new Map([
          ['To read', 0], ['Read but unowned', 0], ['Currently reading', 0], ['Did not finish', 0],
        ])
      ],
      ['Tag',
        new Map([
          ['kindle', 0], ['library', 0],
        ])
      ],
    ]);

    expect(groupFromName('To read', info)).toStrictEqual({ status: 'single', group: { kind: 'Collection', name: 'To read' } });
    expect(groupFromName('kindle', info)).toStrictEqual({ status: 'single', group: { kind: 'Tag', name: 'kindle' } });
    expect(groupFromName('whoops', info)).toStrictEqual({ status: 'not found' });
  });

  test('two kinds, collisions', () => {
    const info = new Map([
      ['Collection',
        new Map([
          ['To read', 0], ['Read but unowned', 0], ['Currently reading', 0], ['Did not finish', 0],
          ['library', 0], ['Tag:kindle', 0],
        ])
      ],
      ['Tag',
        new Map([
          ['kindle', 0], ['library', 0],
        ])
      ],
    ]);

    expect(groupFromName('To read', info)).toStrictEqual({ status: 'single', group: { kind: 'Collection', name: 'To read' } });
    expect(groupFromName('kindle', info)).toStrictEqual({ status: 'single', group: { kind: 'Tag', name: 'kindle' } });
    expect(groupFromName('library', info)).toStrictEqual({ status: 'ambiguous', kinds: ['Collection', 'Tag'] });
    expect(groupFromName('Collection:library', info)).toStrictEqual({ status: 'single', group: { kind: 'Collection', name: 'library' } });
    expect(groupFromName('Tag:library', info)).toStrictEqual({ status: 'single', group: { kind: 'Tag', name: 'library' } });
    expect(groupFromName('Tag:kindle', info)).toStrictEqual({ status: 'found as tagged, original also in kinds', group: { kind: 'Tag', name: 'kindle' }, kinds: ['Collection'] });
    expect(groupFromName('Collection:Tag:kindle', info)).toStrictEqual({ status: 'single', group: { kind: 'Collection', name: 'Tag:kindle' } });
    expect(groupFromName('whoops', info)).toStrictEqual({ status: 'not found' });
  });
});
