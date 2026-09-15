/**
 * Progressive Zheng renderer core: pure alpha / mask analysis.
 *
 * Pipeline (production):
 * current-font 正 glyph -> transparent high-DPI raster -> alpha extraction
 * -> stroke-region analysis -> progressive alpha masks 1-5
 * -> currentColor recolor -> transparent compositing
 *
 * This module contains ONLY pure, DOM-free logic so it can be unit-tested
 * with synthetic alpha bitmaps in jsdom. Real Canvas font rasterization
 * lives in renderer.ts and requires Obsidian / Electron for smoke testing.
 *
 * Glyph source is exclusively the ordinary Han character 正.
 */

export const ZHENG_GLYPH = '正';

export interface ZhengTypography {
  fontFamily: string;
  fontWeight: string;
  fontSize: string;
  fontStyle: string;
  color: string;
  devicePixelRatio: number;
}

export type MaskCacheKeyInput = Pick<
  ZhengTypography,
  'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'devicePixelRatio'
> & { color?: string };

/**
 * Mask / glyph cache identity. Color is deliberately excluded: a theme or
 * editor color change must only trigger recoloring, never re-analysis.
 */
export function buildMaskCacheKey(t: MaskCacheKeyInput): string {
  const dpr = typeof t.devicePixelRatio === 'number' && Number.isFinite(t.devicePixelRatio)
    ? String(t.devicePixelRatio)
    : '1';
  return `${t.fontFamily}||${t.fontSize}||${t.fontWeight}||${t.fontStyle}||${dpr}`;
}

/** Parse CSS font-size like "24px" to number, fallback 16. */
export function parseCssSize(fontSize: string): number {
  const v = parseFloat(fontSize);
  if (!Number.isFinite(v) || v <= 0) return 16;
  return v;
}

/**
 * Backing canvas size for a CSS square glyph. CSS display size and backing
 * pixels are separated for high-DPI: e.g. 24px CSS at DPR=2 uses ~48px backing.
 */
export function computeBackingSize(
  cssSizePx: number,
  dpr: number,
): { width: number; height: number } {
  const css = Number.isFinite(cssSizePx) && cssSizePx > 0 ? cssSizePx : 16;
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const width = Math.max(1, Math.round(css * ratio));
  const height = Math.max(1, Math.round(css * ratio));
  return { width, height };
}

/** Parse rgb()/rgba()/hex colors to [r,g,b]. Returns null when unparsable. */
export function parseCssColor(color: string): [number, number, number] | null {
  const s = color.trim().toLowerCase();
  const rgb = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/);
  if (rgb) {
    const r = Math.min(255, Math.max(0, parseInt(rgb[1], 10)));
    const g = Math.min(255, Math.max(0, parseInt(rgb[2], 10)));
    const b = Math.min(255, Math.max(0, parseInt(rgb[3], 10)));
    return [r, g, b];
  }
  const hex6 = s.match(/^#([0-9a-f]{6})$/);
  if (hex6) {
    return [
      parseInt(hex6[1].slice(0, 2), 16),
      parseInt(hex6[1].slice(2, 4), 16),
      parseInt(hex6[1].slice(4, 6), 16),
    ];
  }
  const hex3 = s.match(/^#([0-9a-f]{3})$/);
  if (hex3) {
    return [
      parseInt(hex3[1][0] + hex3[1][0], 16),
      parseInt(hex3[1][1] + hex3[1][1], 16),
      parseInt(hex3[1][2] + hex3[1][2], 16),
    ];
  }
  if (s === 'black') return [0, 0, 0];
  if (s === 'white') return [255, 255, 255];
  return null;
}

export interface ZhengMaskResult {
  valid: boolean;
  reason?: string;
  masks?: Uint8Array[];
  meta?: {
    gapY1: number;
    gapY2: number;
    midTop: number;
    midBot: number;
    leftL: number;
    leftR: number;
    centralL: number;
    centralR: number;
    yTop: number;
    yMid: number;
    yBot: number;
    xLeft: number;
    xCentral: number;
    bbox: { x0: number; x1: number; y0: number; y1: number };
    fractions: number[];
    strokeFractions: number[];
  };
}

function smooth1D(values: number[], radius: number): number[] {
  if (radius <= 0) return values.slice();
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let n = 0;
    for (let k = i - radius; k <= i + radius; k++) {
      if (k >= 0 && k < values.length) {
        sum += values[k];
        n++;
      }
    }
    out[i] = sum / Math.max(1, n);
  }
  return out;
}

function argMinRange(values: number[], lo: number, hi: number): number {
  const l = Math.max(0, lo);
  const h = Math.min(values.length - 1, hi);
  let best = l;
  for (let i = l + 1; i <= h; i++) {
    if (values[i] < values[best]) best = i;
  }
  return best;
}

function argMaxRange(values: number[], lo: number, hi: number): number {
  const l = Math.max(0, lo);
  const h = Math.min(values.length - 1, hi);
  let best = l;
  for (let i = l + 1; i <= h; i++) {
    if (values[i] > values[best]) best = i;
  }
  return best;
}

/**
 * Dedicated analysis for the single character 正 with stroke ownership.
 *
 * Expected stroke order:
 * 1 top horizontal, 2 central vertical, 3 middle horizontal,
 * 4 left vertical, 5 bottom horizontal.
 *
 * Method: complete glyph alpha -> locate 3 horizontal centers (yTop/yMid/yBot)
 * and 2 vertical centers (xLeft/xCentral) via ink projections + valley search,
 * then assign every ink pixel to exactly one stroke by distance to its
 * centerline segment. Crossings tie-break to the earlier stroke (writing-order
 * ownership), so future-stroke bodies never leak early. Progressive states are
 * unions of exclusive stroke masks, not粗 rectangular reveals.
 *
 * Masks are binary selections; original per-pixel alpha (including partial
 * anti-aliased values) is preserved by the caller. Background (alpha 0)
 * is never included.
 */
function distToHSeg(x: number, y: number, yC: number, xA: number, xB: number): number {
  const cx = x < xA ? xA : x > xB ? xB : x;
  const dx = x - cx;
  const dy = y - yC;
  return Math.sqrt(dx * dx + dy * dy);
}

function distToVSeg(x: number, y: number, xC: number, yA: number, yB: number): number {
  const cy = y < yA ? yA : y > yB ? yB : y;
  const dx = x - xC;
  const dy = y - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

export function analyzeZhengMasks(
  alpha: Uint8Array,
  width: number,
  height: number,
): ZhengMaskResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { valid: false, reason: 'bad-dimensions' };
  }
  if (!alpha || alpha.length !== width * height) {
    return { valid: false, reason: 'bad-alpha-length' };
  }

  let total = 0;
  let inkPixels = 0;
  for (let i = 0; i < alpha.length; i++) {
    total += alpha[i];
    if (alpha[i] > 10) inkPixels++;
  }
  if (total === 0 || inkPixels === 0) {
    return { valid: false, reason: 'empty-raster' };
  }

  let x0 = width;
  let x1 = -1;
  let y0 = height;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) return { valid: false, reason: 'no-bbox' };
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  if (bw < 3 || bh < 3) return { valid: false, reason: 'bbox-too-small' };
  const coverage = inkPixels / (width * height);
  if (coverage < 0.005) return { valid: false, reason: 'ink-too-sparse' };

  const rowSums = new Array<number>(height).fill(0);
  const colSums = new Array<number>(width).fill(0);
  for (let y = 0; y < height; y++) {
    let rs = 0;
    for (let x = 0; x < width; x++) {
      const a = alpha[y * width + x];
      rs += a;
      colSums[x] += a;
    }
    rowSums[y] = rs;
  }

  const radius = Math.min(3, Math.max(1, Math.floor(Math.min(width, height) / 40)));
  const sR = smooth1D(rowSums, radius);
  const sC = smooth1D(colSums, radius);

  const w1lo = y0 + Math.round(bh * 0.18);
  const w1hi = y0 + Math.round(bh * 0.38);
  const w2lo = y0 + Math.round(bh * 0.55);
  const w2hi = y0 + Math.round(bh * 0.78);
  if (w1hi >= w2lo || w1lo > w1hi || w2lo > w2hi) {
    return { valid: false, reason: 'bad-y-windows' };
  }
  const gapY1 = argMinRange(sR, w1lo, w1hi);
  const gapY2 = argMinRange(sR, w2lo, w2hi);
  if (gapY1 >= gapY2) return { valid: false, reason: 'bad-y-gaps' };

  const yTopPeak = argMaxRange(sR, y0, gapY1);
  const yMidPeak = argMaxRange(sR, gapY1, gapY2);
  const yBotPeak = argMaxRange(sR, gapY2, y1);
  const topPeak = sR[yTopPeak];
  const midPeak = sR[yMidPeak];
  const botPeak = sR[yBotPeak];
  const gapAvgY = (sR[gapY1] + sR[gapY2]) / 2;
  if (!(midPeak > gapAvgY * 1.15)) return { valid: false, reason: 'weak-middle-peak' };
  if (!(topPeak > sR[gapY1] * 1.15)) return { valid: false, reason: 'weak-top-peak' };
  if (!(botPeak > sR[gapY2] * 1.15)) return { valid: false, reason: 'weak-bottom-peak' };

  const midThresh = gapAvgY + (midPeak - gapAvgY) * 0.35;
  let midTop = yMidPeak;
  while (midTop > gapY1 && sR[midTop - 1] > midThresh) midTop--;
  let midBot = yMidPeak;
  while (midBot < gapY2 && sR[midBot + 1] > midThresh) midBot++;
  if (midTop > yMidPeak || midBot < yMidPeak) return { valid: false, reason: 'bad-middle-band' };
  if (midBot - midTop + 1 > Math.max(2, Math.round(bh * 0.32))) {
    return { valid: false, reason: 'middle-band-too-wide' };
  }

  const wxlo = x0 + Math.round(bw * 0.28);
  const wxhi = x0 + Math.round(bw * 0.48);
  if (wxlo > wxhi) return { valid: false, reason: 'bad-x-window' };
  const gapX = argMinRange(sC, wxlo, wxhi);
  const xLeftPeak = argMaxRange(sC, x0, gapX);
  const xCentralPeak = argMaxRange(sC, gapX, x1);
  const gapC = sC[gapX];
  const leftPeak = sC[xLeftPeak];
  const centralPeak = sC[xCentralPeak];
  if (!(leftPeak > gapC * 1.15)) return { valid: false, reason: 'weak-left-peak' };
  if (!(centralPeak > gapC * 1.15)) return { valid: false, reason: 'weak-central-peak' };

  const leftThresh = gapC + (leftPeak - gapC) * 0.35;
  let leftL = xLeftPeak;
  while (leftL > x0 && sC[leftL - 1] > leftThresh) leftL--;
  let leftR = xLeftPeak;
  while (leftR < gapX && sC[leftR + 1] > leftThresh) leftR++;
  const centralThresh = gapC + (centralPeak - gapC) * 0.35;
  let centralL = xCentralPeak;
  while (centralL > gapX && sC[centralL - 1] > centralThresh) centralL--;
  let centralR = xCentralPeak;
  while (centralR < x1 && sC[centralR + 1] > centralThresh) centralR++;
  if (leftR >= centralL) return { valid: false, reason: 'columns-overlap' };

  // Stroke centerlines from projection peaks (same glyph, exclusive ownership).
  const yTop = yTopPeak;
  const yMid = yMidPeak;
  const yBot = yBotPeak;
  const xLeft = xLeftPeak;
  const xCentral = xCentralPeak;

  const strokeOf = new Uint8Array(width * height);
  const strokeSums = [0, 0, 0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (alpha[idx] === 0) continue;
      const d1 = distToHSeg(x, y, yTop, x0, x1);
      const d2 = distToVSeg(x, y, xCentral, yTop, yBot);
      const d3 = distToHSeg(x, y, yMid, x0, x1);
      const d4 = distToVSeg(x, y, xLeft, yMid, yBot);
      const d5 = distToHSeg(x, y, yBot, x0, x1);
      let best = 0;
      let bestD = d1;
      if (d2 < bestD - 1e-9) {
        best = 1;
        bestD = d2;
      }
      if (d3 < bestD - 1e-9) {
        best = 2;
        bestD = d3;
      }
      if (d4 < bestD - 1e-9) {
        best = 3;
        bestD = d4;
      }
      if (d5 < bestD - 1e-9) {
        best = 4;
        bestD = d5;
      }
      strokeOf[idx] = best + 1;
      strokeSums[best] += alpha[idx];
    }
  }

  const masks: Uint8Array[] = [];
  for (let k = 0; k < 5; k++) masks.push(new Uint8Array(width * height));

  for (let i = 0; i < alpha.length; i++) {
    const s = strokeOf[i];
    if (s === 0) continue;
    for (let k = s - 1; k < 5; k++) masks[k][i] = 1;
  }

  const sums = masks.map((m) => {
    let s = 0;
    for (let i = 0; i < alpha.length; i++) if (m[i]) s += alpha[i];
    return s;
  });
  const fractions = sums.map((s) => s / total);
  const strokeFractions = strokeSums.map((s) => s / total);
  const [f1, f2, f3, f4] = fractions;
  if (!(f1 >= 0.05 && f1 <= 0.6)) return { valid: false, reason: 'bad-f1' };
  if (!(f2 > f1 && f2 >= 0.15 && f2 <= 0.8)) return { valid: false, reason: 'bad-f2' };
  if (!(f3 > f2 && f3 >= 0.3 && f3 <= 0.92)) return { valid: false, reason: 'bad-f3' };
  if (!(f4 > f3 && f4 >= 0.5 && f4 <= 0.995)) return { valid: false, reason: 'bad-f4' };
  if (!(f2 - f1 > 0.02 && f3 - f2 > 0.02 && f4 - f3 > 0.02)) {
    return { valid: false, reason: 'stroke-too-small' };
  }
  for (const sf of strokeFractions) {
    if (!(sf >= 0.03 && sf <= 0.6)) return { valid: false, reason: 'bad-stroke-share' };
  }
  // Strict superset check on ink pixels.
  for (let n = 1; n < 5; n++) {
    const prev = masks[n - 1];
    const cur = masks[n];
    for (let i = 0; i < prev.length; i++) {
      if (prev[i] && !cur[i]) return { valid: false, reason: 'not-superset' };
    }
  }
  // State 5 must equal full ink exactly.
  for (let i = 0; i < alpha.length; i++) {
    const hasInk = alpha[i] > 0 ? 1 : 0;
    if (masks[4][i] !== hasInk) return { valid: false, reason: 'state5-mismatch' };
  }

  return {
    valid: true,
    masks,
    meta: {
      gapY1,
      gapY2,
      midTop,
      midBot,
      leftL,
      leftR,
      centralL,
      centralR,
      yTop,
      yMid,
      yBot,
      xLeft,
      xCentral,
      bbox: { x0, x1, y0, y1 },
      fractions,
      strokeFractions,
    },
  };
}

/**
 * Recolor a single progressive state: RGB comes from the current editor
 * color, alpha comes from the original glyph raster masked by state.
 * Background stays fully transparent (0,0,0,0). Partial anti-aliased alpha
 * values are copied verbatim, never binarized.
 */
export function recolorWithMask(
  alpha: Uint8Array,
  mask: Uint8Array,
  rgb: [number, number, number],
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (mask[i] && alpha[i] > 0) {
      out[o] = rgb[0];
      out[o + 1] = rgb[1];
      out[o + 2] = rgb[2];
      out[o + 3] = alpha[i];
    } else {
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + 3] = 0;
    }
  }
  return out;
}
