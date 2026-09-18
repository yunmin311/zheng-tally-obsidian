import type { ZhengTypography } from './zheng-progressive';
import {
  ZHENG_FLIP_TRANSFORM,
  ZHENG_STROKES,
  ZHENG_VIEWBOX,
} from './zheng-strokes';

export type { ZhengTypography };
export type EditorTypography = ZhengTypography;

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface InlineTallyRenderer {
  readonly element: HTMLElement;
  readonly isFallback: boolean;
  update(count: number): void;
  onClick(callback: () => void): void;
  destroy(): void;
}

export function readHostTypography(dom: HTMLElement): ZhengTypography | null {
  try {
    const computed = getComputedStyle(dom);
    if (!computed) return null;
    let dpr = 1;
    try {
      dpr =
        typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
          ? window.devicePixelRatio
          : 1;
      if (!Number.isFinite(dpr) || dpr <= 0) dpr = 1;
    } catch {
      dpr = 1;
    }
    return {
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      fontStyle: computed.fontStyle,
      color: computed.color,
      devicePixelRatio: dpr,
    };
  } catch {
    return null;
  }
}

/**
 * Copies the host editor's typography onto a generated element.
 *
 * `opts.fontSize === false` skips font size so a CSS class can own it: an
 * inline font-size would otherwise beat the class (inline always wins), and
 * elements like the total-count suffix deliberately scale relative to the
 * chip rather than matching the editor font.
 */
export function applyTypography(
  el: HTMLElement,
  typo: ZhengTypography,
  opts?: { fontSize?: boolean },
): void {
  el.style.fontFamily = typo.fontFamily;
  if (opts?.fontSize !== false) el.style.fontSize = typo.fontSize;
  el.style.fontWeight = typo.fontWeight;
  el.style.fontStyle = typo.fontStyle;
  el.style.color = typo.color;
}

/**
 * One canonical tally glyph: hidden native 正 is the ONLY sizing element
 * (real advance width, line box, baseline from the current editor font).
 * The canonical SVG strokes overlay the same grid cell and must never
 * contribute intrinsic sizing: SVG default 300x150 intrinsic dimensions
 * are suppressed via contain:size + min-zero + overflow clipping, so the
 * grid track is decided by the native 正 alone. No fixed 1em frame.
 */
export function buildVectorGlyph(shownStrokes: number, typo: ZhengTypography): HTMLElement {
  const clamped = Math.max(0, Math.min(ZHENG_STROKES.length, Math.floor(shownStrokes)));
  const cell = createEl('span');
  cell.className = 'zt-glyph';
  cell.setAttribute('data-strokes', String(clamped));
  cell.style.cssText = `
    display: inline-grid;
    grid-template-areas: "cell";
    line-height: 1;
    background: transparent;
  `;
  applyTypography(cell, typo);

  const native = createEl('span');
  native.className = 'zt-native zt-native-sizing';
  native.setAttribute('aria-hidden', 'true');
  native.textContent = '正';
  native.style.cssText = `
    grid-area: cell;
    visibility: hidden;
    line-height: inherit;
  `;
  applyTypography(native, typo);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'zt-svg zt-vector');
  svg.setAttribute('viewBox', ZHENG_VIEWBOX);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');
  (svg as unknown as HTMLElement).style.cssText = `
    grid-area: cell;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    display: block;
    overflow: hidden;
    contain: size layout;
    background: transparent;
    align-self: stretch;
    justify-self: stretch;
  `;
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('transform', ZHENG_FLIP_TRANSFORM);
  group.setAttribute('fill', 'currentColor');
  for (let i = 0; i < clamped; i++) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ZHENG_STROKES[i]);
    path.setAttribute('data-stroke', String(i + 1));
    group.appendChild(path);
  }
  svg.appendChild(group);
  cell.appendChild(native);
  cell.appendChild(svg);
  return cell;
}

function buildEllipsis(typo: ZhengTypography): HTMLElement {
  const el = createEl('span');
  el.className = 'zt-ellipsis';
  el.textContent = '…';
  el.style.cssText = `
    background: transparent;
    opacity: 0.6;
  `;
  applyTypography(el, typo);
  return el;
}

function buildTotalCount(count: number, typo: ZhengTypography): HTMLElement {
  const el = createEl('span');
  el.className = 'zt-total';
  el.textContent = String(count);
  // Size, opacity and tabular figures come from `.zt-total` in styles.css.
  // Font size is intentionally left to the class so it stays relative to the
  // chip (0.75em of the editor font) instead of being pinned inline.
  applyTypography(el, typo, { fontSize: false });
  return el;
}

function appendGlyph(
  container: HTMLElement,
  shownStrokes: number,
  full: boolean,
  index: number,
  typo: ZhengTypography,
): void {
  const span = createEl('span');
  span.className = 'zt-tally';
  if (full) span.setAttribute('data-full', 'true');
  span.setAttribute('data-state', full ? '5' : String(shownStrokes));
  span.setAttribute('data-index', String(index));
  span.style.cssText = `
    display: inline-flex;
    align-items: center;
    background: transparent;
  `;
  applyTypography(span, typo);
  span.appendChild(buildVectorGlyph(shownStrokes, typo));
  container.appendChild(span);
}

/**
 * True inline chip for CM6 Decoration.widget. Participates in editor layout
 * (inline-flex, no absolute/fixed, no editor-root style changes).
 *
 * Up to 4 group slots render fully (each +1 visibly adds a stroke).
 * Beyond that the preview compacts to two leading fulls, an ellipsis, the
 * most-recent completed full, and the current partial slot — the in-progress
 * group is always visible. The transient preview never alters
 * the real integer count; commit format is unchanged.
 *
 * mode 'active': live tally session chip (strong chrome, total always shown).
 * mode 'persisted': committed-tally chip reusing the same glyph pipeline and
 * box metrics; chrome is quieter and the total is hidden by default via
 * visibility (space reserved, so revealing it never shifts layout).
 */
export type TallyChipMode = 'active' | 'persisted';

export function buildTallyChip(
  count: number,
  typo: ZhengTypography,
  onClick: (() => void) | null,
  mode: TallyChipMode = 'active',
  showTotal = true,
): HTMLElement {
  const safe = Math.max(0, Math.floor(count));
  const persisted = mode === 'persisted';
  const chip = createEl('span');
  chip.className = 'zheng-tally-inline';
  chip.setAttribute('data-inline-widget', 'true');
  chip.setAttribute('data-count', String(safe));
  chip.setAttribute('data-mode', mode);
  chip.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    padding: 0.1em 0.35em;
    margin: 0 0.15em;
    background: ${persisted ? 'transparent' : 'var(--background-secondary)'};
    border: 1px ${persisted ? 'dashed' : 'solid'} var(--background-modifier-border);
    border-radius: 4px;
    white-space: nowrap;
    vertical-align: text-bottom;
  `;
  applyTypography(chip, typo);

  const preview = createEl('span');
  preview.className = 'zt-preview';
  preview.style.cssText = `
    display: inline-flex;
    gap: 0.15em;
    line-height: 1;
    background: transparent;
  `;
  applyTypography(preview, typo);

  const q = Math.floor(safe / 5);
  const r = safe % 5;
  // Group slots: every completed group of five plus the current partial one.
  // Up to 4 slots render fully so each +1 visibly adds a stroke; beyond that
  // the preview compacts but ALWAYS keeps the most-recent completed group
  // and the current partial slot — the in-progress group never vanishes.
  const groups = q + (r > 0 ? 1 : 0);
  if (groups <= 4) {
    for (let i = 0; i < q; i++) appendGlyph(preview, 5, true, i, typo);
    if (r > 0) appendGlyph(preview, r, false, q, typo);
  } else {
    appendGlyph(preview, 5, true, 0, typo);
    appendGlyph(preview, 5, true, 1, typo);
    preview.appendChild(buildEllipsis(typo));
    appendGlyph(preview, 5, true, q - 1, typo);
    if (r > 0) appendGlyph(preview, r, false, q, typo);
  }
  chip.appendChild(preview);
  const totalEl = buildTotalCount(safe, typo);
  // Committed tallies hide the running total until hover/selection; the rule
  // is `.zt-total--hidden` in styles.css and is toggled from persistent-tally.
  if (persisted && !showTotal) totalEl.classList.add('zt-total--hidden');
  chip.appendChild(totalEl);
  if (onClick) {
    chip.addEventListener('click', () => {
      onClick();
    });
  }
  return chip;
}

/**
 * Explicit fallback chip (text only) for catastrophic paths such as an
 * unreadable host typography. Never used on the normal vector path; marked
 * so tests and smoke checks can tell it apart.
 */
export function buildFallbackChip(count: number, typo: ZhengTypography): HTMLElement {
  const safe = Math.max(0, Math.floor(count));
  const chip = createEl('span');
  chip.className = 'zheng-tally-inline';
  chip.setAttribute('data-inline-widget', 'true');
  chip.setAttribute('data-fallback', 'text');
  chip.setAttribute('data-count', String(safe));
  chip.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    padding: 0.1em 0.35em;
    margin: 0 0.15em;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    white-space: nowrap;
    vertical-align: text-bottom;
  `;
  applyTypography(chip, typo);
  chip.textContent = `[${safe}]`;
  return chip;
}

/**
 * Explicit fixed-overlay fallback only. Normal path must use Decoration widget.
 * Marked with data-fallback-mode="fixed" so tests and smoke checks can tell.
 */
export function createFallbackOverlayRenderer(typo: ZhengTypography): InlineTallyRenderer {
  let clickCallback: (() => void) | null = null;
  const root = createDiv();
  root.className = 'zheng-tally-overlay';
  root.setAttribute('data-fallback-mode', 'fixed');
  root.style.cssText = `
    position: fixed;
    z-index: 1000;
    pointer-events: none;
    font-family: inherit;
  `;
  const inner = createDiv();
  inner.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    padding: 0.2em 0.4em;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    pointer-events: auto;
    white-space: nowrap;
  `;
  applyTypography(inner, typo);
  const label = createEl('span');
  label.textContent = '[tally]';
  applyTypography(label, typo);
  inner.appendChild(label);
  root.appendChild(inner);
  inner.addEventListener('click', () => {
    if (clickCallback) clickCallback();
  });
  return {
    get element() {
      return root;
    },
    get isFallback() {
      return true;
    },
    update(_count: number) {
      // Fallback carries no progressive preview.
    },
    onClick(callback: () => void) {
      clickCallback = callback;
    },
    destroy() {
      try {
        if (root.parentNode) root.parentNode.removeChild(root);
      } catch {
        // Ignore teardown races.
      }
      clickCallback = null;
    },
  };
}
