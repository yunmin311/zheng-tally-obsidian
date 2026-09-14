export interface TallyState {
  readonly count: number;
  increment(): void;
  decrement(): void;
  reset(): void;
  quotient(): number;
  remainder(): number;
  toStableText(): string;
  toUnicodeText(): string;
}

const UNICODE_TALLY = ['', '\u{1D372}', '\u{1D373}', '\u{1D374}', '\u{1D375}', '\u{1D376}'] as const;

export function createTallyState(initialCount = 0): TallyState {
  let count = Math.max(0, Math.floor(initialCount));

  return {
    get count() {
      return count;
    },
    increment() {
      count += 1;
    },
    decrement() {
      count = Math.max(0, count - 1);
    },
    reset() {
      count = 0;
    },
    quotient() {
      return Math.floor(count / 5);
    },
    remainder() {
      return count % 5;
    },
    toStableText() {
      if (count === 0) return '';
      const q = this.quotient();
      const r = this.remainder();
      const full = '正'.repeat(q);
      return r > 0 ? `${full}·${r}` : full;
    },
    toUnicodeText() {
      if (count === 0) return '';
      const q = this.quotient();
      const r = this.remainder();
      return UNICODE_TALLY[5].repeat(q) + UNICODE_TALLY[r];
    },
  };
}