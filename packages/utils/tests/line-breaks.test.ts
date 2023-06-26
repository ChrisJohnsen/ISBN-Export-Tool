import { describe, test, expect } from '@jest/globals';
import { estimatedLinesForText } from 'utils/line-breaks.js';

const fakeFm = {
  enWidth: 1,
  spaceWidth: 0.5,
  averageLowercaseWidth: 0.75,
  averageUppercaseWidth: 1.25,
};

describe('estimatedLinesForText', () => {
  test('empty string is one line', () => {
    const lines = estimatedLinesForText(fakeFm)(10, '');

    expect(lines).toHaveLength(1);
    expect(lines[0].beforeIndex).toEqual(0);
  });

  test('single line', () => {
    const str = 'This is some text.';
    const lines = estimatedLinesForText(fakeFm)(17, str);

    expect(lines).toHaveLength(1);
    expect(lines).toMatchSnapshot(str);
  });

  test('normal break', () => {
    const str = 'This is longer text. It will break onto two lines.';
    const lines = estimatedLinesForText(fakeFm)(23, str);

    expect(lines).toHaveLength(2);
    expect(lines).toMatchSnapshot(str);
  });

  test('two lines, no extra breaks', () => {
    const str = 'This has two lines.\nThis is the second.';
    const lines = estimatedLinesForText(fakeFm)(20, str);

    expect(lines).toHaveLength(2);
    expect(lines).toMatchSnapshot(str);
  });

  test('two lines, both breaking', () => {
    const str = 'This is the first long line. It will break.\nThe second line will also break into two.';
    const lines = estimatedLinesForText(fakeFm)(20, str);

    expect(lines).toHaveLength(4);
    expect(lines).toMatchSnapshot(str);
  });

  test('underscore is not a preferred break point', () => {
    const str = 'An_underscore?';
    const lines = estimatedLinesForText(fakeFm)(10, str);

    expect(lines).toHaveLength(2);
    expect(lines[0].breakCount).toEqual(0);
    expect(lines[0].pointsRemaining).toBeLessThanOrEqual(3 + fakeFm.averageLowercaseWidth); // break should be in "underscore": lots of lowercase letters
    expect(lines).toMatchSnapshot(str);
  });

  test.each(Array.from(' !-/?|}'))('breaking character: %s', c => {
    const str = '_____' + c + '_____';
    const lines = estimatedLinesForText(fakeFm)(10, str);

    expect(lines).toHaveLength(2);
    expect(lines[0].beforeIndex).toEqual(6);
    expect(lines).toMatchSnapshot(str);
  });

  test('pseudo-realistic', () => {
    const lines = estimatedLinesForText({
      // Large (100%), bold; measured on a 2x scaled device
      enWidth: 9.5,
      spaceWidth: 4.1,
      averageLowercaseWidth: 8.711538461538462,
      averageUppercaseWidth: 11.423076923076923,
    })(374, 'This is a semi-realistic example that uses a realistic font measure set.\nIt has a "hard" line break. It also has lots of text that wil flow over multiple display lines.');

    expect(lines).toHaveLength(5);
    expect(lines
      .map(line =>
      ({
        ...line,
        lastBreakPoints: line.lastBreakPoints.toFixed(3), // these are not integers, so round them to a few digits and check them as strings
        pointsRemaining: line.pointsRemaining.toFixed(3),
      })))
      .toMatchSnapshot();
  });
});
