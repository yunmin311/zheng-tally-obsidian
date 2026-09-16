import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, ViewPlugin, WidgetType, type EditorView } from '@codemirror/view';
import type { Plugin } from 'obsidian';

export interface StableToken {
  from: number;
  to: number;
  count: number;
}

/**
 * Stable commit formats produced by this plugin:
 * - "·r" (r 1-4) -> r
 * - "正".repeat(k) + "·r" -> 5k + r
 * - "正".repeat(k), k >= 2 -> 5k (a lone bare 正 is left alone: it is far too
 *   common in ordinary Chinese prose to badge every one of them)
 *
 * Conservative token boundary (deliberate design limit, no heuristics):
 * a candidate only counts when BOTH neighbours are a hard boundary, i.e.
 * start/end of document, whitespace, punctuation or symbol. Inside ordinary
 * Han/Latin/digit runs there is no badge: 正正好, 正正方方, 测试正正内容 and
 * 第·3项 must NOT badge. Both the hover and the caret path share this parser.
 */
const STABLE_TOKEN_RE = /(正{2,}(?:·[1-4])?|正·[1-4]|·[1-4])/g;

/**
 * A neighbour breaks the boundary when it could continue ordinary prose:
 * any letter (Han included), any number, `_`, or a tally char itself.
 * Everything else (whitespace, punctuation, symbols, string ends) is a
 * boundary. `正` is already covered by \p{L}; `·` (U+00B7, Po) is explicit.
 */
const BOUNDARY_BREAK_RE = /[\p{L}\p{N}_·]/u;

function hasTokenBoundary(text: string, from: number, to: number): boolean {
  const prev = from > 0 ? text[from - 1] : '';
  if (prev && BOUNDARY_BREAK_RE.test(prev)) return false;
  const next = to < text.length ? text[to] : '';
  if (next && BOUNDARY_BREAK_RE.test(next)) return false;
  return true;
}

export function parseStableTokens(text: string, baseOffset: number): StableToken[] {
  const out: StableToken[] = [];
  STABLE_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  try {
    while ((m = STABLE_TOKEN_RE.exec(text)) !== null) {
      const token = m[0];
      if (!token) continue;
      if (!hasTokenBoundary(text, m.index, m.index + token.length)) continue;
      const start = baseOffset + m.index;
      const end = start + token.length;
      let count: number | null = null;
      if (token[0] === '·') {
        count = Number(token.slice(1));
      } else {
        const dot = token.indexOf('·');
        if (dot >= 0) {
          count = (dot * 5) + Number(token.slice(dot + 1));
        } else if (token.length >= 2) {
          count = token.length * 5;
        }
      }
      if (count !== null && Number.isFinite(count) && count > 0) {
        out.push({ from: start, to: end, count });
      }
      if (m.index === STABLE_TOKEN_RE.lastIndex) STABLE_TOKEN_RE.lastIndex++;
    }
  } catch {
    return out;
  }
  return out;
}

export class CountBadge extends WidgetType {
  constructor(readonly count: number) {
    super();
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'zt-count-badge';
    el.setAttribute('data-count', String(this.count));
    el.title = `tally count: ${this.count}`;
    el.textContent = String(this.count);
    el.style.cssText = `
      display: inline-flex;
      align-items: center;
      font-size: 0.72em;
      opacity: 0.8;
      font-variant-numeric: tabular-nums;
      margin: 0 0.2em;
      padding: 0 0.35em;
      border-radius: 3px;
      background: var(--background-secondary);
      border: 1px solid var(--background-modifier-border);
      color: inherit;
      vertical-align: text-bottom;
      cursor: default;
    `;
    return el;
  }

  eq(other: CountBadge): boolean {
    return other instanceof CountBadge && other.count === this.count;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export const setHoverEffect = StateEffect.define<number>();
export const clearHoverEffect = StateEffect.define<void>();

export const hoverPosField: StateField<number | null> = StateField.define<number | null>({
  create() {
    return null;
  },
  update(pos, tr) {
    for (const e of tr.effects) {
      if (e.is(setHoverEffect)) return e.value;
      if (e.is(clearHoverEffect)) return null;
    }
    if (pos !== null && tr.docChanged) {
      try {
        pos = tr.changes.mapPos(pos);
      } catch {
        return null;
      }
    }
    return pos;
  },
});

/**
 * Committed-tally count badge as an anchored transient overlay.
 *
 * The badge is a single `position: fixed` popup appended to
 * `document.body` and anchored to the token rect. It never participates
 * in editor layout, so showing/hiding it cannot shift surrounding prose
 * (no layout shift by construction). It never writes the document.
 * The normal tally input widget stays a true CM6 inline Decoration.
 */
function findActiveToken(view: EditorView, hover: number | null): StableToken | null {
  try {
    const sel = view.state.selection.main.head;
    for (const { from, to } of view.visibleRanges) {
      let text = '';
      try {
        text = view.state.sliceDoc(from, to);
      } catch {
        continue;
      }
      for (const token of parseStableTokens(text, from)) {
        const hovered = hover !== null && hover >= token.from && hover <= token.to;
        const caret = sel >= token.from && sel <= token.to;
        if (hovered || caret) return token;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function placePopup(view: EditorView, popup: HTMLElement, token: StableToken): void {
  let coords: { left: number; top: number; bottom: number } | null = null;
  try {
    coords = view.coordsAtPos(token.from);
  } catch {
    coords = null;
  }
  if (!coords) {
    try {
      coords = view.coordsAtPos(token.to);
    } catch {
      coords = null;
    }
  }
  popup.textContent = String(token.count);
  popup.setAttribute('data-count', String(token.count));
  popup.title = `tally count: ${token.count}`;
  if (coords) {
    popup.style.left = `${Math.round(coords.left)}px`;
    // Anchor above the token rect with a small gap.
    popup.style.top = `${Math.round(coords.top)}px`;
    popup.style.transform = 'translate(0, -110%)';
  }
}

const hoverViewPlugin = ViewPlugin.fromClass(
  class {
    popup: HTMLElement | null = null;
    placeTimer: ReturnType<typeof setTimeout> | null = null;
    constructor(_view: EditorView) {
      // Popup is created lazily on first active token; never in layout.
    }

    update(update: {
      docChanged: boolean;
      selectionSet: boolean;
      viewportChanged: boolean;
      view: EditorView;
      transactions: ReadonlyArray<{ effects: ReadonlyArray<unknown> }>;
    }): void {
      let hover: number | null = null;
      try {
        hover = update.view.state.field(hoverPosField, false) ?? null;
      } catch {
        hover = null;
      }
      const token = findActiveToken(update.view, hover);
      if (!token) {
        this.hide();
        return;
      }
      try {
        if (!this.popup) {
          this.popup = new CountBadge(token.count).toDOM();
          this.popup.classList.add('zt-count-badge-popup');
          this.popup.setAttribute('data-transient', 'overlay');
          // Overlay positioning: out of editor layout entirely.
          this.popup.style.position = 'fixed';
          this.popup.style.zIndex = '1000';
          this.popup.style.pointerEvents = 'none';
          this.popup.style.margin = '0';
          document.body.appendChild(this.popup);
        }
        this.popup.textContent = String(token.count);
        this.popup.setAttribute('data-count', String(token.count));
        // Never measure synchronously inside update(): CM6 has not synced
        // the DOM yet, so coordsAtPos can return null here. Defer past the
        // transaction (setTimeout fires even when backgrounded; rAF does not).
        this.schedulePlace(update.view, token);
      } catch {
        // Hover badge is best-effort; never break the editor.
      }
    }

    schedulePlace(view: EditorView, token: StableToken): void {
      try {
        if (this.placeTimer !== null) clearTimeout(this.placeTimer);
      } catch {
        // Ignore timer races.
      }
      const popup = this.popup;
      if (!popup) return;
      try {
        this.placeTimer = setTimeout(() => {
          this.placeTimer = null;
          try {
            if (this.popup !== popup || !popup.parentNode) return;
            placePopup(view, popup, token);
          } catch {
            // Best-effort anchoring only.
          }
        }, 30);
      } catch {
        // Timers unavailable: leave the last good anchor in place.
      }
    }

    hide(): void {
      try {
        if (this.placeTimer !== null) {
          clearTimeout(this.placeTimer);
          this.placeTimer = null;
        }
      } catch {
        // Ignore timer races.
      }
      try {
        if (this.popup && this.popup.parentNode) {
          this.popup.parentNode.removeChild(this.popup);
        }
      } catch {
        // Ignore teardown races.
      }
      this.popup = null;
    }

    destroy(): void {
      this.hide();
    }
  },
  {
    decorations: () => Decoration.none,
    eventHandlers: {
      mouseover(event: MouseEvent, view: EditorView) {
        try {
          const pos = view.posAtDOM(event.target as unknown as Node);
          if (typeof pos === 'number' && Number.isFinite(pos)) {
            view.dispatch({ effects: setHoverEffect.of(pos) });
          }
        } catch {
          // Hover tracking is best-effort.
        }
      },
      mouseout(_event: MouseEvent, view: EditorView) {
        try {
          view.dispatch({ effects: clearHoverEffect.of(undefined) });
        } catch {
          // Hover tracking is best-effort.
        }
      },
    },
  },
);

export const tallyHoverExtension = [hoverPosField, hoverViewPlugin];

/** Register the committed-tally hover/caret count badge. No doc writes. */
export function registerTallyHover(plugin: Plugin): void {
  try {
    plugin.registerEditorExtension(tallyHoverExtension);
  } catch {
    // Hover badge is optional; never break plugin load.
  }
}
