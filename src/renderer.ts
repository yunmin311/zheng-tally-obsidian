import type { Editor } from 'obsidian';
import {
  ZHENG_GLYPH,
  analyzeZhengMasks,
  buildMaskCacheKey,
  computeBackingSize,
  parseCssColor,
  parseCssSize,
  recolorWithMask,
} from './zheng-progressive';

interface CodeMirrorEditor {
  wrapperElement: HTMLElement;
}

interface EditorWithCM extends Editor {
  cm: CodeMirrorEditor;
}

export interface TallyRenderer {
  mount(container: HTMLElement): void;
  update(count: number): void;
  onClick(callback: () => void): void;
  destroy(): void;
}

const FULL_GLYPH = ZHENG_GLYPH;

export interface EditorTypography {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
  devicePixelRatio: number;
}

function getDevicePixelRatio(): number {
  try {
    const dpr =
      typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
        ? window.devicePixelRatio
        : 1;
    if (!Number.isFinite(dpr) || dpr <= 0) return 1;
    return dpr;
  } catch {
    return 1;
  }
}

export function readEditorTypography(editor: Editor): EditorTypography {
  const cm = (editor as EditorWithCM).cm;
  const wrapper = cm?.wrapperElement;
  let computed: CSSStyleDeclaration;
  try {
    computed = wrapper ? getComputedStyle(wrapper) : getComputedStyle(document.body);
  } catch {
    computed = getComputedStyle(document.body);
  }
  return {
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    fontWeight: computed.fontWeight,
    fontStyle: computed.fontStyle,
    color: computed.color,
    devicePixelRatio: getDevicePixelRatio(),
  };
}

export function applyTypography(el: HTMLElement, typo: EditorTypography): void {
  el.style.fontFamily = typo.fontFamily;
  el.style.fontSize = typo.fontSize;
  el.style.fontWeight = typo.fontWeight;
  el.style.fontStyle = typo.fontStyle;
  el.style.color = typo.color;
}

interface GlyphCacheEntry {
  key: string;
  width: number;
  height: number;
  alpha: Uint8Array;
  masks: Uint8Array[];
}

/** Transparent raster of the current-font 正 glyph; caches shape, never pixels. */
function rasterizeZhengAlpha(
  typo: EditorTypography,
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
    // Canvas starts fully transparent; never bake a background color.
    ctx.clearRect(0, 0, width, height);
    try {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.font = `${typo.fontStyle} ${typo.fontWeight} ${cssSizePx}px ${typo.fontFamily}`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      // Opaque placeholder ink; only the alpha channel is kept.
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

function buildGlyphCache(typo: EditorTypography): GlyphCacheEntry | null {
  const key = buildMaskCacheKey(typo);
  const raster = rasterizeZhengAlpha(typo);
  if (!raster) return null;
  const res = analyzeZhengMasks(raster.alpha, raster.width, raster.height);
  if (!res.valid || !res.masks) return null;
  return { key, width: raster.width, height: raster.height, alpha: raster.alpha, masks: res.masks };
}

/** Recolor one progressive state onto a transparent canvas. */
function compositeStateToCanvas(
  entry: GlyphCacheEntry,
  state: number,
  color: string,
  typo: EditorTypography,
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
    const imageData = new ImageData(
      Uint8ClampedArray.from(rgba),
      entry.width,
      entry.height,
    );
    ctx.putImageData(imageData, 0, 0);
    const cssSizePx = parseCssSize(typo.fontSize);
    void cssSizePx;
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

function createFallbackSpan(state: number, typo: EditorTypography): HTMLElement {
  const span = document.createElement('span');
  span.textContent = `[${state}]`;
  span.style.opacity = '0.6';
  applyTypography(span, typo);
  span.style.background = 'transparent';
  span.setAttribute('data-fallback', String(state));
  return span;
}

export function createTallyRenderer(editor: Editor): TallyRenderer {
  const initialTypo = readEditorTypography(editor);
  let clickCallback: (() => void) | null = null;
  let overlay: HTMLElement | null = null;
  let tallyContainer: HTMLElement | null = null;
  let countDisplay: HTMLElement | null = null;
  let glyphCache: GlyphCacheEntry | null = null;
  let glyphCacheFailed = false;

  function ensureGlyphCache(typo: EditorTypography): GlyphCacheEntry | null {
    const key = buildMaskCacheKey(typo);
    if (glyphCache && glyphCache.key === key) return glyphCache;
    // Mask key changed (family/size/weight/style/DPR): regenerate.
    // Color-only changes keep the same key and skip re-analysis.
    if (glyphCacheFailed && glyphCache === null) {
      // Retry once per distinct key: clear flag when key changes.
      // If same key already failed, avoid hot-loop raster on every keystroke
      // but still allow color-only recolor via fallback path.
      // We track last failed key implicitly by keeping failed flag + null cache;
      // a new key resets the flag below.
    }
    const fresh = buildGlyphCache(typo);
    if (fresh) {
      glyphCache = fresh;
      glyphCacheFailed = false;
      return glyphCache;
    }
    // Explicit fallback: keep null cache, render [N] markers.
    if (!glyphCache || glyphCache.key !== key) {
      glyphCache = null;
      glyphCacheFailed = true;
    }
    return null;
  }

  function buildOverlay(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'zheng-tally-overlay';
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
    applyTypography(inner, initialTypo);

    tallyContainer = document.createElement('span');
    tallyContainer.style.cssText = `
      display: inline-flex;
      gap: 0.15em;
      line-height: 1;
      background: transparent;
    `;
    applyTypography(tallyContainer, initialTypo);

    countDisplay = document.createElement('span');
    countDisplay.style.cssText = `
      font-size: 0.75em;
      opacity: 0.7;
      font-variant-numeric: tabular-nums;
      background: transparent;
    `;
    applyTypography(countDisplay, initialTypo);

    inner.appendChild(tallyContainer);
    inner.appendChild(countDisplay);
    root.appendChild(inner);

    inner.addEventListener('click', () => {
      if (clickCallback) clickCallback();
    });

    return root;
  }

  function renderTally(count: number): void {
    if (!tallyContainer) return;
    let typo: EditorTypography;
    try {
      typo = readEditorTypography(editor);
    } catch {
      typo = initialTypo;
    }
    const entry = ensureGlyphCache(typo);
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
        const canvas = compositeStateToCanvas(entry, 5, typo.color, typo);
        if (canvas) {
          span.appendChild(canvas);
        } else {
          span.textContent = FULL_GLYPH;
        }
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
        const canvas = compositeStateToCanvas(entry, r, typo.color, typo);
        if (canvas) {
          span.appendChild(canvas);
        } else {
          const fb = createFallbackSpan(r, typo);
          span.appendChild(fb);
        }
      } else {
        const fb = createFallbackSpan(r, typo);
        span.appendChild(fb);
      }
      tallyContainer.appendChild(span);
    }

    if (countDisplay) {
      // Keep count legible across themes via inherited editor color.
      try {
        applyTypography(countDisplay, typo);
      } catch {
        // Never let a typography refresh break the session.
      }
      countDisplay.textContent = String(count);
    }
  }

  return {
    mount(container: HTMLElement) {
      overlay = buildOverlay();
      container.appendChild(overlay);
      renderTally(0);
    },
    update(count: number) {
      renderTally(count);
    },
    onClick(callback: () => void) {
      clickCallback = callback;
    },
    destroy() {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      overlay = null;
      tallyContainer = null;
      countDisplay = null;
      glyphCache = null;
      glyphCacheFailed = false;
      clickCallback = null;
    },
  };
}

export type { EditorTypography as EditorTypographyType };
