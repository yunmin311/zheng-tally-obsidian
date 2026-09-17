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

export interface MarkedTally {
  from: number;
  to: number;
  count: number;
}

/** Pure stable-text serializer shared by the state object and marker verification. */
export function stableTextForCount(rawCount: number): string {
  const count = Math.max(0, Math.floor(rawCount));
  if (count === 0) return '';
  const q = Math.floor(count / 5);
  const r = count % 5;
  const full = '正'.repeat(q);
  return r > 0 ? `${full}·${r}` : full;
}

/**
 * Persistent storage format: visible stable text plus a plugin ownership
 * marker carrying the integer source of truth, e.g. `正正正·3<!--zt:18-->`.
 * Readers without the plugin still see the readable tally text; no external
 * position mapping, no zero-width hacks. Count 0 is never persisted.
 */
export function toMarkedText(rawCount: number): string {
  const count = Math.max(0, Math.floor(rawCount));
  if (count <= 0) return '';
  return `${stableTextForCount(count)}<!--zt:${count}-->`;
}

const MARKED_RE = /(正+(?:·[1-4])?|·[1-4])<!--zt:(\d+)-->/g;

/**
 * Parse verified marked tallies. A candidate is only accepted when the
 * marker count re-serializes to exactly the preceding visible tally;
 * mismatches fail closed (no widget, no document rewrite). Ordinary HTML
 * comments never match.
 */
export function parseMarkedTallies(text: string, baseOffset: number): MarkedTally[] {
  const out: MarkedTally[] = [];
  MARKED_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  try {
    while ((m = MARKED_RE.exec(text)) !== null) {
      const visible = m[1];
      const count = Number(m[2]);
      if (!visible || !Number.isSafeInteger(count) || count <= 0) continue;
      if (stableTextForCount(count) !== visible) continue;
      out.push({ from: baseOffset + m.index, to: baseOffset + m.index + m[0].length, count });
      if (m.index === MARKED_RE.lastIndex) MARKED_RE.lastIndex++;
    }
  } catch {
    return out;
  }
  return out;
}

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
      return stableTextForCount(count);
    },
    toUnicodeText() {
      if (count === 0) return '';
      const q = this.quotient();
      const r = this.remainder();
      return UNICODE_TALLY[5].repeat(q) + UNICODE_TALLY[r];
    },
  };
}