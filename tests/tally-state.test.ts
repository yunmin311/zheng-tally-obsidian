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
    const cases: [number, string][] = [
      [0, ''],
      [1, '𝍡'],
      [4, '𝍤'],
      [5, '𝍥'],
      [6, '𝍥𝍡'],
      [18, '𝍥𝍥𝍥𝍣'],
      [25, '𝍥𝍥𝍥𝍥𝍥'],
    ];

    test.each(cases)('%d → "%s"', (input, expected) => {
      expect(createTallyState(input).toUnicodeText()).toBe(expected);
    });
  });
});