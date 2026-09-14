import { createTallyState } from '../src/tally-state';

describe('TallyState', () => {
  test('initial count defaults to 0', () => {
    const state = createTallyState();
    expect(state.count).toBe(0);
  });

  test('initial count can be set', () => {
    const state = createTallyState(10);
    expect(state.count).toBe(10);
  });

  test('increment increases count', () => {
    const state = createTallyState(3);
    state.increment();
    expect(state.count).toBe(4);
  });

  test('decrement decreases count', () => {
    const state = createTallyState(5);
    state.decrement();
    expect(state.count).toBe(4);
  });

  test('decrement floors at zero', () => {
    const state = createTallyState(0);
    state.decrement();
    expect(state.count).toBe(0);
  });

  test('reset sets count to zero', () => {
    const state = createTallyState(18);
    state.reset();
    expect(state.count).toBe(0);
  });

  test('quotient returns floor(count / 5)', () => {
    expect(createTallyState(0).quotient()).toBe(0);
    expect(createTallyState(4).quotient()).toBe(0);
    expect(createTallyState(5).quotient()).toBe(1);
    expect(createTallyState(9).quotient()).toBe(1);
    expect(createTallyState(18).quotient()).toBe(3);
    expect(createTallyState(25).quotient()).toBe(5);
  });

  test('remainder returns count % 5', () => {
    expect(createTallyState(0).remainder()).toBe(0);
    expect(createTallyState(1).remainder()).toBe(1);
    expect(createTallyState(4).remainder()).toBe(4);
    expect(createTallyState(5).remainder()).toBe(0);
    expect(createTallyState(6).remainder()).toBe(1);
    expect(createTallyState(18).remainder()).toBe(3);
  });

  describe('toStableText', () => {
    const cases: [number, string][] = [
      [0, ''],
      [1, '·1'],
      [4, '·4'],
      [5, '正'],
      [6, '正·1'],
      [8, '正·3'],
      [18, '正正正·3'],
      [25, '正正正正正'],
    ];

    test.each(cases)('%d → "%s"', (input, expected) => {
      expect(createTallyState(input).toStableText()).toBe(expected);
    });
  });

  describe('toUnicodeText', () => {
    const TALLY_1 = '\u{1D372}'; // 𝍲
    const TALLY_2 = '\u{1D373}'; // 𝍳
    const TALLY_3 = '\u{1D374}'; // 𝍴
    const TALLY_4 = '\u{1D375}'; // 𝍵
    const TALLY_5 = '\u{1D376}'; // 𝍶

    const cases: [number, string][] = [
      [0, ''],
      [1, TALLY_1],
      [2, TALLY_2],
      [3, TALLY_3],
      [4, TALLY_4],
      [5, TALLY_5],
      [6, TALLY_5 + TALLY_1],
      [18, TALLY_5.repeat(3) + TALLY_3],
      [25, TALLY_5.repeat(5)],
    ];

    test.each(cases)('%d → "%s"', (input, expected) => {
      expect(createTallyState(input).toUnicodeText()).toBe(expected);
    });

    test('unicode tally marks have correct code points', () => {
      expect(TALLY_1.codePointAt(0)).toBe(0x1D372);
      expect(TALLY_2.codePointAt(0)).toBe(0x1D373);
      expect(TALLY_3.codePointAt(0)).toBe(0x1D374);
      expect(TALLY_4.codePointAt(0)).toBe(0x1D375);
      expect(TALLY_5.codePointAt(0)).toBe(0x1D376);
    });

    test('toUnicodeText output characters have correct code points', () => {
      const output = createTallyState(18).toUnicodeText();
      // Each tally char is a surrogate pair (2 code units), so indices are 0, 2, 4, 6
      expect(output.codePointAt(0)).toBe(0x1D376); // first 正
      expect(output.codePointAt(2)).toBe(0x1D376); // second 正
      expect(output.codePointAt(4)).toBe(0x1D376); // third 正
      expect(output.codePointAt(6)).toBe(0x1D374); // remainder 3
    });
  });
});