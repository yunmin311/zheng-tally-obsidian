import type { ZhengTypography } from './zheng-progressive';
import {
  ZHENG_GLYPH,
  analyzeZhengMasks,
  buildMaskCacheKey,
  computeBackingSize,
  parseCssColor,
  parseCssSize,
  recolorWithMask,
} from './zheng-progressive';

export type { ZhengTypography };
export type EditorTypography = ZhengTypography;

const FULL_GLYPH = ZHENG_GLYPH;

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

export function applyTypography(el: HTMLElement, typo: ZhengTypography): void {
  el.style.fontFamily = typo.fontFamily;
  el.style.fontSize = typo.fontSize;
  el.style.fontWeight = typo.fontWeight;
  el.style.fontStyle = typo.fontStyle;
  el.style.color = typo.color;
}

export interface GlyphCacheEntry {
  key: string;
  width: number;
  height: number;
  alpha: Uint8Array;
  masks: Uint8Array[];
}

function rasterizeZhengAlpha(
  typo: ZhengTypography,
): { width: number; height: number; alpha: Uint8Array } | null {
  try {
    const cssSizePx = parseCssSize(typo.fontSize);
    const dpr = typo.devicePixelRatio > 0 ? typo.devicePixelRatio : 1;
    const { width, height } = computeBackingSize(cssSizePx, dpr);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      return null;
    }
    if (!ctx) return null;
    ctx.clearRect(0, 0, width, height);
    try {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.font = `${typo.fontStyle} ${typo.fontWeight} ${cssSizePx}px ${typo.fontFamily}`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgb(0, 0, 0)';
      ctx.fillText(FULL_GLYPH, 0, 0);
      ctx.restore();
    } catch {
      return null;
    }
    let imageData: ImageData;
    try {
      imageData = ctx.getImageData(0, 0, width, height);
    } catch {
      return null;
    }
    const alpha = new Uint8Array(width * height);
    let ink = 0;
    for (let i = 0; i < width * height; i++) {
      const a = imageData.data[i * 4 + 3];
      alpha[i] = a;
      if (a > 0) ink++;
    }
    if (ink === 0) return null;
    return { width, height, alpha };
  } catch {
    return null;
  }
}

export function buildGlyphCache(typo: ZhengTypography): GlyphCacheEntry | null {
  const key = buildMaskCacheKey(typo);
  const raster = rasterizeZhengAlpha(typo);
  if (!raster) return null;
  const res = analyzeZhengMasks(raster.alpha, raster.width, raster.height);
  if (!res.valid || !res.masks) return null;
  return { key, width: raster.width, height: raster.height, alpha: raster.alpha, masks: res.masks };
}

function compositeStateToCanvas(
  entry: GlyphCacheEntry,
  state: number,
  color: string,
): HTMLCanvasElement | null {
  try {
    if (state < 1 || state > 5) return null;
    const mask = entry.masks[state - 1];
    if (!mask) return null;
    const rgb = parseCssColor(color);
    if (!rgb) return null;
    const rgba = recolorWithMask(entry.alpha, mask, rgb, entry.width, entry.height);
    const canvas = document.createElement('canvas');
    canvas.width = entry.width;
    canvas.height = entry.height;
    canvas.setAttribute('data-zheng-state', String(state));
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      return null;
    }
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const imageData = new ImageData(Uint8ClampedArray.from(rgba), entry.width, entry.height);
    ctx.putImageData(imageData, 0, 0);
    canvas.style.cssText = `
      display: inline-block;
      width: 1em;
      height: 1em;
      vertical-align: text-bottom;
      background: transparent;
    `;
    return canvas;
  } catch {
    return null;
  }
}

function createFallbackSpan(state: number, typo: ZhengTypography): HTMLElement {
  const span = document.createElement('span');
  span.textContent = `[${state}]`;
  span.style.opacity = '0.6';
  applyTypography(span, typo);
  span.style.background = 'transparent';
  span.setAttribute('data-fallback', String(state));
  return span;
}

function renderCountInto(
  tallyContainer: HTMLElement,
  countDisplay: HTMLElement,
  count: number,
  typo: ZhengTypography,
  entry: GlyphCacheEntry | null,
): void {
  tallyContainer.innerHTML = '';
  const q = Math.floor(count / 5);
  const r = count % 5;
  for (let i = 0; i < q; i++) {
    const span = document.createElement('span');
    span.setAttribute('data-full', 'true');
    span.setAttribute('data-state', '5');
    span.style.cssText = `
      display: inline-flex;
      align-items: center;
      background: transparent;
    `;
    applyTypography(span, typo);
    span.style.background = 'transparent';
    if (entry) {
      const canvas = compositeStateToCanvas(entry, 5, typo.color);
      if (canvas) span.appendChild(canvas);
      else span.textContent = FULL_GLYPH;
    } else {
      span.textContent = FULL_GLYPH;
    }
    tallyContainer.appendChild(span);
  }
  if (r > 0) {
    const span = document.createElement('span');
    span.setAttribute('data-state', String(r));
    span.style.cssText = `
      display: inline-flex;
      align-items: center;
      background: transparent;
    `;
    applyTypography(span, typo);
    span.style.background = 'transparent';
    if (entry) {
      const canvas = compositeStateToCanvas(entry, r, typo.color);
      if (canvas) span.appendChild(canvas);
      else span.appendChild(createFallbackSpan(r, typo));
    } else {
      span.appendChild(createFallbackSpan(r, typo));
    }
    tallyContainer.appendChild(span);
  }
  try {
    applyTypography(countDisplay, typo);
  } catch {
    // Never break session on typography refresh.
  }
  countDisplay.textContent = String(count);
}

/**
 * True inline chip for CM6 Decoration.widget. Participates in editor layout
 * (inline-flex, no absolute/fixed, no editor-root style changes).
 */
export function buildTallyChip(
  count: number,
  entry: GlyphCacheEntry | null,
  typo: ZhengTypography,
  onClick: (() => void) | null,
): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'zheng-tally-inline';
  chip.setAttribute('data-inline-widget', 'true');
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

  const tallyContainer = document.createElement('span');
  tallyContainer.style.cssText = `
    display: inline-flex;
    gap: 0.15em;
    line-height: 1;
    background: transparent;
  `;
  applyTypography(tallyContainer, typo);

  const countDisplay = document.createElement('span');
  countDisplay.style.cssText = `
    font-size: 0.75em;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
    background: transparent;
  `;
  applyTypography(countDisplay, typo);

  chip.appendChild(tallyContainer);
  chip.appendChild(countDisplay);
  renderCountInto(tallyContainer, countDisplay, count, typo, entry);
  if (onClick) {
    chip.addEventListener('click', () => {
      onClick();
    });
  }
  return chip;
}

/**
 * Explicit fixed-overlay fallback only. Normal path must use Decoration widget.
 * Marked with data-fallback-mode="fixed" so tests and smoke checks can tell.
 */
export function createFallbackOverlayRenderer(typo: ZhengTypography): InlineTallyRenderer {
  let clickCallback: (() => void) | null = null;
  const root = document.createElement('div');
  root.className = 'zheng-tally-overlay';
  root.setAttribute('data-fallback-mode', 'fixed');
  root.style.cssText = `
    position: fixed;
    z-index: 1000;
    pointer-events: none;
    font-family: inherit;
  `;
  const inner = document.createElement('div');
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
  const tallyContainer = document.createElement('span');
  tallyContainer.style.cssText = `
    display: inline-flex;
    gap: 0.15em;
    line-height: 1;
    background: transparent;
  `;
  applyTypography(tallyContainer, typo);
  const countDisplay = document.createElement('span');
  countDisplay.style.cssText = `
    font-size: 0.75em;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
    background: transparent;
  `;
  applyTypography(countDisplay, typo);
  inner.appendChild(tallyContainer);
  inner.appendChild(countDisplay);
  root.appendChild(inner);
  inner.addEventListener('click', () => {
    if (clickCallback) clickCallback();
  });
  renderCountInto(tallyContainer, countDisplay, 0, typo, null);
  return {
    get element() {
      return root;
    },
    get isFallback() {
      return true;
    },
    update(count: number) {
      renderCountInto(tallyContainer, countDisplay, count, typo, null);
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
