import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { parseMarkedTallies, type MarkedTally } from './tally-state';
import { parseStableTokens } from './tally-hover';
import { buildTallyChip, readHostTypography, type ZhengTypography } from './renderer';

export interface ResumeToken {
  from: number;
  to: number;
  count: number;
  legacy: boolean;
}

export interface SuppressRange {
  from: number;
  to: number;
}

/**
 * Resume lookup for Alt+Z / click. Marked tokens win (explicit ownership,
 * caret inside or directly adjacent); otherwise a single conservative legacy
 * token containing the caret may resume (lone bare 正 never qualifies — the
 * shared parser already excludes it). Ambiguity fails closed to a fresh tally.
 */
export function findResumeToken(docText: string, offset: number): ResumeToken | null {
  try {
    const marked = parseMarkedTallies(docText, 0);
    const hit = marked.find((t) => offset >= t.from - 1 && offset <= t.to + 1);
    if (hit) return { from: hit.from, to: hit.to, count: hit.count, legacy: false };
    const legacy = parseStableTokens(docText, 0).filter(
      (t) => offset >= t.from && offset <= t.to,
    );
    if (legacy.length === 1) {
      const only = legacy[0];
      return { from: only.from, to: only.to, count: only.count, legacy: true };
    }
  } catch {
    return null;
  }
  return null;
}

export const setSuppressEffect = StateEffect.define<SuppressRange | null>();

export const persistentSuppressField: StateField<SuppressRange | null> = StateField.define<SuppressRange | null>({
  create() {
    return null;
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSuppressEffect)) return e.value;
    }
    if (value && tr.docChanged) {
      try {
        const from = tr.changes.mapPos(value.from, 1);
        const to = tr.changes.mapPos(value.to, -1);
        if (Number.isFinite(from) && Number.isFinite(to) && from <= to) return { from, to };
        return null;
      } catch {
        return null;
      }
    }
    return value;
  },
});

/** Suppress (or release with null) the persistent range an active session owns. Fail-closed. */
export function dispatchPersistentSuppress(view: EditorView, range: SuppressRange | null): boolean {
  try {
    view.dispatch({ effects: setSuppressEffect.of(range) });
    return true;
  } catch {
    return false;
  }
}

const FALLBACK_TYPOGRAPHY: ZhengTypography = {
  fontFamily: 'serif',
  fontSize: '16px',
  fontWeight: '400',
  fontStyle: 'normal',
  color: 'rgb(0,0,0)',
  devicePixelRatio: 1,
};

class PersistentTallyWidget extends WidgetType {
  constructor(
    readonly token: MarkedTally,
    readonly showTotal: boolean,
    readonly onResume: (token: ResumeToken) => void,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    let typo: ZhengTypography | null = null;
    try {
      typo = readHostTypography(view.dom);
    } catch {
      typo = null;
    }
    const token = this.token;
    const el = buildTallyChip(
      token.count,
      typo ?? FALLBACK_TYPOGRAPHY,
      () => {
        try {
          this.onResume({ from: token.from, to: token.to, count: token.count, legacy: false });
        } catch {
          // Resume is best-effort; never break rendering.
        }
      },
      'persisted',
      this.showTotal,
    );
    el.setAttribute('data-persistent', 'true');
    const total = el.querySelector('.zt-total');
    const syncTotal = (visible: boolean): void => {
      try {
        if (total) (total as HTMLElement).style.visibility = visible ? 'visible' : 'hidden';
      } catch {
        // Ignore teardown races.
      }
    };
    el.addEventListener('mouseenter', () => syncTotal(true));
    el.addEventListener('mouseleave', () => {
      let selected = this.showTotal;
      try {
        const sel = view.state.selection.main;
        selected = sel.from <= token.to && sel.to >= token.from;
      } catch {
        // Keep build-time value.
      }
      syncTotal(selected);
    });
    return el;
  }

  eq(other: PersistentTallyWidget): boolean {
    return (
      other instanceof PersistentTallyWidget &&
      other.token.from === this.token.from &&
      other.token.to === this.token.to &&
      other.token.count === this.token.count &&
      other.showTotal === this.showTotal &&
      other.onResume === this.onResume
    );
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function selectionTouches(state: EditorState, from: number, to: number): boolean {
  try {
    const sel = state.selection.main;
    return sel.from <= to && sel.to >= from;
  } catch {
    return false;
  }
}

/** Collect verified marked tokens, skipping any range an active session owns. */
export function collectPersistedTokens(
  state: EditorState,
  suppress: SuppressRange | null,
): MarkedTally[] {
  try {
    const tokens = parseMarkedTallies(state.doc.toString(), 0);
    if (!suppress) return tokens;
    return tokens.filter((t) => t.to <= suppress.from || t.from >= suppress.to);
  } catch {
    return [];
  }
}

export function createPersistentTallyField(
  onResume: (token: ResumeToken) => void,
): StateField<DecorationSet> {
  const build = (state: EditorState): DecorationSet => {
    let suppress: SuppressRange | null = null;
    try {
      suppress = state.field(persistentSuppressField, false) ?? null;
    } catch {
      suppress = null;
    }
    const tokens = collectPersistedTokens(state, suppress);
    const ranges = tokens.map((t) =>
      Decoration.replace({
        widget: new PersistentTallyWidget(t, selectionTouches(state, t.from, t.to), onResume),
      }).range(t.from, t.to),
    );
    return Decoration.set(ranges, true);
  };
  return StateField.define<DecorationSet>({
    create: build,
    update(_deco, tr) {
      // Ranges re-derive from the document every transaction, so mapping is
      // automatic for edits before, inside, or after a persistent tally.
      void _deco;
      return build(tr.state);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

/** Independent persistent-tally extension (replace decorations, never absolute/fixed). */
export function createPersistentTallyExtension(
  onResume: (token: ResumeToken) => void,
): Extension {
  return [persistentSuppressField, createPersistentTallyField(onResume)];
}
