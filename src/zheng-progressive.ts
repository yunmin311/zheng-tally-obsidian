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
  alphas?: Uint8Array[];
  meta?: {
    top: [number, number];
    mid: [number, number];
    bot: [number, number];
    centralCols: [number, number];
    centralRows: [number, number];
    leftCols: [number, number];
    leftRows: [number, number];
    hThresh: number;
    vThresh: number;
    bbox: { x0: number; x1: number; y0: number; y1: number };
    fractions: number[];
    addShares: number[];
  };
}

interface SpanGroup {
  a0: number;
  a1: number;
  mass: number;
}

function contiguousGroups(has: boolean[], massOf: (i: number) => number): SpanGroup[] {
  const groups: SpanGroup[] = [];
  let i = 0;
  while (i < has.length) {
    if (!has[i]) {
      i++;
      continue;
    }
    const a0 = i;
    let mass = 0;
    while (i < has.length && has[i]) {
      mass += massOf(i);
      i++;
    }
    groups.push({ a0, a1: i - 1, mass });
  }
  return groups;
}

/**
 * Dedicated analysis for the single character 正: orientation-first extraction.
 *
 * Expected stroke order:
 * 1 top horizontal, 2 central vertical, 3 middle horizontal,
 * 4 left vertical, 5 bottom horizontal.
 *
 * Method: from the complete glyph alpha bitmap, keep only ink with genuine
 * directional continuity (horizontal run-length for horizontals, vertical
 * run-length for verticals, thresholds relative to the glyph bbox). A short
 * central nub can never enter a horizontal stroke and horizontal thickness
 * can never enter a vertical stroke. Horizontal candidates cluster into
 * top/middle/bottom bands, vertical candidates into central/left columns.
 * Junction pixels shared by both directions surface with the earlier stroke;
 * mixed alpha failing its owner's gate stays hidden until state 5.
 * Progressive states are cleaned unions, never粗 rectangular reveals, and
 * state 5 restores the original glyph pixel-for-pixel.
 *
 * Masks are binary selections; original per-pixel alpha (including partial
 * anti-aliased values) is preserved by the caller. Background (alpha 0)
 * is never included.
 */
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

  // Binary structure: faint AA (<=10) rides along only inside true strokes.
  const B = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) B[i] = alpha[i] > 10 ? 1 : 0;

  // Per-pixel directional run support.
  const hRun = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      if (!B[y * width + x]) {
        x++;
        continue;
      }
      let x1r = x;
      while (x1r + 1 < width && B[y * width + x1r + 1]) x1r++;
      const len = x1r - x + 1;
      for (let k = x; k <= x1r; k++) hRun[y * width + k] = len;
      x = x1r + 1;
    }
  }
  const vRun = new Uint16Array(width * height);
  for (let x = 0; x < width; x++) {
    let y = 0;
    while (y < height) {
      if (!B[y * width + x]) {
        y++;
        continue;
      }
      let y1r = y;
      while (y1r + 1 < height && B[(y1r + 1) * width + x]) y1r++;
      const len = y1r - y + 1;
      for (let k = y; k <= y1r; k++) vRun[k * width + x] = len;
      y = y1r + 1;
    }
  }

  // Continuity thresholds relative to the glyph bbox: a 2-3px nub or bar
  // thickness can never qualify as the transverse stroke.
  const hThresh = Math.max(3, Math.round(bw * 0.3));
  const vThresh = Math.max(3, Math.round(bh * 0.25));
  const Hcand = new Uint8Array(width * height);
  const Vcand = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) {
    if (!B[i]) continue;
    if (hRun[i] >= hThresh) Hcand[i] = 1;
    if (vRun[i] >= vThresh) Vcand[i] = 1;
  }

  // Three horizontal bands from Hcand rows (verticals are excluded by
  // construction, so bands separate cleanly).
  const hRowHas = new Array<boolean>(height).fill(false);
  const hRowMass = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (Hcand[y * width + x]) {
        hRowHas[y] = true;
        hRowMass[y]++;
      }
    }
  }
  let hGroups = contiguousGroups(hRowHas, (y) => hRowMass[y]);
  if (hGroups.length < 3) return { valid: false, reason: 'h-bands' };
  if (hGroups.length > 3) {
    hGroups = hGroups
      .slice()
      .sort((a, b) => b.mass - a.mass)
      .slice(0, 3);
  }
  hGroups.sort((a, b) => a.a0 - b.a0);
  const [topG, midG, botG] = hGroups;
  if (!(topG.a1 < midG.a0 && midG.a1 < botG.a0)) return { valid: false, reason: 'h-bands-merge' };
  const maxBandH = Math.max(3, Math.round(bh * 0.3));
  for (const g of hGroups) {
    if (g.a1 - g.a0 + 1 > maxBandH) return { valid: false, reason: 'h-band-too-wide' };
    if (g.mass < Math.max(4, inkPixels * 0.03)) return { valid: false, reason: 'h-band-weak' };
  }
  const t0 = topG.a0;
  const t1 = topG.a1;
  const m0 = midG.a0;
  const m1 = midG.a1;
  const b0 = botG.a0;
  const b1 = botG.a1;

  // Two verticals from Vcand columns (horizontals excluded by construction).
  const vColHas = new Array<boolean>(width).fill(false);
  const vColMass = new Array<number>(width).fill(0);
  const vColMinY = new Array<number>(width).fill(height);
  const vColMaxY = new Array<number>(width).fill(-1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (Vcand[y * width + x]) {
        vColHas[x] = true;
        vColMass[x]++;
        if (y < vColMinY[x]) vColMinY[x] = y;
        if (y > vColMaxY[x]) vColMaxY[x] = y;
      }
    }
  }
  let vGroups = contiguousGroups(vColHas, (x) => vColMass[x]);
  if (vGroups.length < 2) return { valid: false, reason: 'v-cols' };
  if (vGroups.length > 2) {
    vGroups = vGroups
      .slice()
      .sort((a, b) => b.mass - a.mass)
      .slice(0, 2);
  }
  vGroups.sort((a, b) => a.a0 - b.a0);
  const [leftG, centralG] = vGroups;
  if (!(leftG.a1 < centralG.a0)) return { valid: false, reason: 'v-cols-merge' };
  let cMinY = height;
  let cMaxY = -1;
  for (let x = centralG.a0; x <= centralG.a1; x++) {
    if (!vColHas[x]) continue;
    if (vColMinY[x] < cMinY) cMinY = vColMinY[x];
    if (vColMaxY[x] > cMaxY) cMaxY = vColMaxY[x];
  }
  let lMinY = height;
  let lMaxY = -1;
  for (let x = leftG.a0; x <= leftG.a1; x++) {
    if (!vColHas[x]) continue;
    if (vColMinY[x] < lMinY) lMinY = vColMinY[x];
    if (vColMaxY[x] > lMaxY) lMaxY = vColMaxY[x];
  }
  // Central spans top->bottom; left starts below the top band at/near the
  // middle band (its detected top may sit a few rows above the middle bar
  // where the two strokes merge) and reaches the bottom band.
  if (!(cMinY <= t1 + 2 && cMaxY >= b0 - 2)) return { valid: false, reason: 'v-central-span' };
  if (!(lMinY > t1 && lMinY <= m1 + 1 && lMaxY >= b0 - 2)) return { valid: false, reason: 'v-left-span' };
  if (centralG.mass < Math.max(4, inkPixels * 0.03)) return { valid: false, reason: 'v-central-weak' };
  if (leftG.mass < Math.max(4, inkPixels * 0.02)) return { valid: false, reason: 'v-left-weak' };
  const cx0 = centralG.a0;
  const cx1 = centralG.a1;
  const lx0 = leftG.a0;
  const lx1 = leftG.a1;

  // ---- Stroke reconstruction (independent strokes, explicit junctions) ----
  // Contaminated x-intervals where strokes merge; margin 1px so flares belong
  // to no early state. Clean samples come from the same glyph's unmerged runs.
  const cenX0 = cx0 - 1;
  const cenX1 = cx1 + 1;
  const glLeftX0 = lx0 - 1;
  const glLeftX1 = lx1 + 1;
  const inBandTop = (y: number): boolean => y >= t0 && y <= t1;
  const inBandMid = (y: number): boolean => y >= m0 && y <= m1;

  // Per-row clean reference for horizontals: max alpha outside contaminated
  // intervals on that row (0 when the row offers no clean ink).
  const refTop = new Uint8Array(height);
  const refMid = new Uint8Array(height);
  for (let y = t0; y <= t1; y++) {
    let m = 0;
    for (let x = x0; x <= x1; x++) {
      if (x >= cenX0 && x <= cenX1) continue;
      const a = alpha[y * width + x];
      if (a > m) m = a;
    }
    refTop[y] = m;
  }
  for (let y = m0; y <= m1; y++) {
    let m = 0;
    for (let x = x0; x <= x1; x++) {
      if ((x >= cenX0 && x <= cenX1) || (x >= glLeftX0 && x <= glLeftX1)) continue;
      const a = alpha[y * width + x];
      if (a > m) m = a;
    }
    refMid[y] = m;
  }
  // Per-column clean reference for verticals: max alpha outside band rows.
  const refCen = new Uint8Array(width);
  const refLeft = new Uint8Array(width);
  for (let x = cx0; x <= cx1; x++) {
    let m = 0;
    for (let y = t0; y < b0; y++) {
      if (inBandTop(y) || inBandMid(y)) continue;
      const a = alpha[y * width + x];
      if (a > m) m = a;
    }
    refCen[x] = m;
  }
  for (let x = lx0; x <= lx1; x++) {
    let m = 0;
    for (let y = lMinY; y < b0; y++) {
      if (inBandMid(y)) continue;
      const a = alpha[y * width + x];
      if (a > m) m = a;
    }
    refLeft[x] = m;
  }

  // Reconstructed stroke alpha maps. Junctions use the owner stroke's own
  // clean profile; future strokes never contribute early. Verticals end flat
  // above the bottom band; the bottom band arrives whole with S5.
  const topR = new Uint8Array(width * height);
  const cenR = new Uint8Array(width * height);
  const midR = new Uint8Array(width * height);
  const leftR = new Uint8Array(width * height);
  for (let y = t0; y <= t1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * width + x;
      if (alpha[i] === 0) continue;
      topR[i] = x >= cenX0 && x <= cenX1 ? refTop[y] || alpha[i] : alpha[i];
    }
  }
  for (let y = t0; y < b0; y++) {
    for (let x = cx0; x <= cx1; x++) {
      const i = y * width + x;
      if (alpha[i] === 0) continue;
      const inBand = inBandTop(y) || inBandMid(y);
      cenR[i] = inBand ? refCen[x] || alpha[i] : alpha[i];
    }
  }
  for (let y = m0; y <= m1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * width + x;
      if (alpha[i] === 0) continue;
      const inCen = x >= cenX0 && x <= cenX1;
      const inL = x >= glLeftX0 && x <= glLeftX1;
      midR[i] = inCen || inL ? refMid[y] || alpha[i] : alpha[i];
    }
  }
  for (let y = lMinY; y < b0; y++) {
    for (let x = lx0; x <= lx1; x++) {
      const i = y * width + x;
      if (alpha[i] === 0) continue;
      leftR[i] = inBandMid(y) ? refLeft[x] || alpha[i] : alpha[i];
    }
  }

  // Progressive composition by alpha union (max). S5 restores full original.
  const masks: Uint8Array[] = [];
  const alphas: Uint8Array[] = [];
  for (let k = 0; k < 5; k++) {
    masks.push(new Uint8Array(width * height));
    alphas.push(new Uint8Array(width * height));
  }
  const layers = [topR, cenR, midR, leftR];
  const addSums = [0, 0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const prevA = alphas[k];
    const prevM = masks[k];
    if (k > 0) {
      prevA.set(alphas[k - 1]);
      prevM.set(masks[k - 1]);
    }
    const layer = layers[k];
    for (let i = 0; i < alpha.length; i++) {
      const v = layer[i];
      if (v === 0) continue;
      if (prevM[i] === 0) addSums[k] += v;
      prevM[i] = 1;
      if (v > prevA[i]) prevA[i] = v;
    }
  }
  {
    const fullM = masks[4];
    const fullA = alphas[4];
    const prevM = masks[3];
    for (let i = 0; i < alpha.length; i++) {
      if (alpha[i] > 0) {
        if (prevM[i] === 0) addSums[4] += alpha[i];
        fullM[i] = 1;
        fullA[i] = alpha[i];
      }
    }
  }

  const sums = masks.map((m) => {
    let s = 0;
    for (let i = 0; i < alpha.length; i++) if (m[i]) s += alpha[i];
    return s;
  });
  const fractions = sums.map((s) => s / total);
  const addShares = addSums.map((s) => s / total);
  const [f1, f2, f3, f4] = fractions;
  if (!(f1 >= 0.04 && f1 <= 0.6)) return { valid: false, reason: 'bad-f1' };
  if (!(f2 > f1 && f2 >= 0.15 && f2 <= 0.85)) return { valid: false, reason: 'bad-f2' };
  if (!(f3 > f2 && f3 >= 0.3 && f3 <= 0.93)) return { valid: false, reason: 'bad-f3' };
  if (!(f4 > f3 && f4 >= 0.5 && f4 <= 0.995)) return { valid: false, reason: 'bad-f4' };
  if (!(f2 - f1 > 0.015 && f3 - f2 > 0.015 && f4 - f3 > 0.015)) {
    return { valid: false, reason: 'stroke-too-small' };
  }
  for (const sf of addShares) {
    if (!(sf >= 0.02 && sf <= 0.65)) return { valid: false, reason: 'bad-stroke-share' };
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
    alphas,
    meta: {
      top: [t0, t1],
      mid: [m0, m1],
      bot: [b0, b1],
      centralCols: [cx0, cx1],
      centralRows: [cMinY, cMaxY],
      leftCols: [lx0, lx1],
      leftRows: [lMinY, lMaxY],
      hThresh,
      vThresh,
      bbox: { x0, x1, y0, y1 },
      fractions,
      addShares,
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
