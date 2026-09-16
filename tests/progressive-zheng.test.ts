import * as fs from 'fs';
import * as path from 'path';
import {
  buildMaskCacheKey,
  computeBackingSize,
  analyzeZhengMasks,
  recolorWithMask,
  parseCssColor,
  type ZhengTypography,
} from '../src/zheng-progressive';
import {
  buildFallbackChip,
  buildTallyChip,
  readHostTypography,
} from '../src/renderer';
import { resolveEditorHost } from '../src/editor-host';

// ---------------------------------------------------------------------------
// Synthetic 正 alpha bitmap (pure, no canvas/font rasterization).
// Layout (W=40,H=40):
//  top Heng:    rows 6-8,   cols 8-31
//  central Shu: rows 6-33,  cols 18-20
//  middle Heng: rows 17-19, cols 10-29
//  left Shu:    rows 17-32, cols 10-12
//  bottom Heng: rows 31-33, cols 8-31
// Plus explicit anti-aliased edge pixels with partial alpha.
// ---------------------------------------------------------------------------
const SW = 40;
const SH = 40;

function buildSyntheticZhengAlpha(): Uint8Array {
  const alpha = new Uint8Array(SW * SH);
  const set = (x: number, y: number, v: number) => {
    if (x < 0 || y < 0 || x >= SW || y >= SH) return;
    alpha[y * SW + x] = v;
  };
  const fillRect = (x0: number, y0: number, x1: number, y1: number, v = 255) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, v);
  };
  fillRect(8, 6, 31, 8); // top Heng
  fillRect(18, 6, 20, 33); // central Shu
  fillRect(10, 17, 29, 19); // middle Heng
  fillRect(10, 17, 12, 32); // left Shu
  fillRect(8, 31, 31, 33); // bottom Heng
  // In-band anti-aliased edge pixels (partial alpha inside true strokes).
  set(9, 6, 128);
  set(19, 18, 96);
  set(11, 25, 140);
  set(25, 32, 110);
  // Isolated single-pixel noise: no directional continuity, hidden until S5.
  set(8, 5, 77);
  set(32, 5, 64);
  return alpha;
}

function sumMaskedAlpha(alpha: Uint8Array, mask: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < alpha.length; i++) if (mask[i]) s += alpha[i];
  return s;
}

const baseTypo: ZhengTypography = {
  fontFamily: 'SimSun, serif',
  fontSize: '24px',
  fontWeight: '400',
  fontStyle: 'normal',
  color: 'rgb(0, 0, 0)',
  devicePixelRatio: 1,
};

describe('progressive-zheng: pure alpha/mask analysis (synthetic bitmap, no font raster)', () => {
  test('states 1→5 are strictly monotonic cumulative supersets', () => {
    const alpha = buildSyntheticZhengAlpha();
    const res = analyzeZhengMasks(alpha, SW, SH);
    expect(res.valid).toBe(true);
    expect(res.masks).toHaveLength(5);
    const sums = res.masks!.map((m: Uint8Array) => sumMaskedAlpha(alpha, m));
    for (let i = 1; i < sums.length; i++) {
      expect(sums[i]).toBeGreaterThan(sums[i - 1]);
    }
    for (let n = 1; n < 5; n++) {
      const prev = res.masks![n - 1];
      const cur = res.masks![n];
      for (let i = 0; i < prev.length; i++) {
        if (prev[i]) expect(cur[i]).toBe(1);
      }
    }
  });

  test('state 5 alpha matches full 正 alpha (identical ink)', () => {
    const alpha = buildSyntheticZhengAlpha();
    const res = analyzeZhengMasks(alpha, SW, SH);
    expect(res.valid).toBe(true);
    const mask5 = res.masks![4];
    for (let i = 0; i < alpha.length; i++) {
      const hasInk = alpha[i] > 0 ? 1 : 0;
      expect(mask5[i]).toBe(hasInk);
    }
    expect(sumMaskedAlpha(alpha, mask5)).toBe(alpha.reduce((a, b) => a + b, 0));
    for (let i = 0; i < alpha.length; i++) {
      expect(res.alphas![4][i]).toBe(alpha[i]);
    }
  });

  test('transparent background: zero-alpha source stays zero in every state', () => {
    const alpha = buildSyntheticZhengAlpha();
    const res = analyzeZhengMasks(alpha, SW, SH);
    const rgb: [number, number, number] = [0, 0, 0];
    for (const mask of res.masks!) {
      const rgba = recolorWithMask(alpha, mask, rgb, SW, SH);
      for (let i = 0; i < alpha.length; i++) {
        const outA = rgba[i * 4 + 3];
        if (alpha[i] === 0) expect(outA).toBe(0);
      }
    }
  });

  test('anti-aliased alpha is preserved, never binarized', () => {
    const alpha = buildSyntheticZhengAlpha();
    const partial = Array.from(alpha).filter((v) => v > 0 && v < 255);
    expect(partial.length).toBeGreaterThan(0);
    const res = analyzeZhengMasks(alpha, SW, SH);
    expect(res.valid).toBe(true);
    expect(res.alphas).toHaveLength(5);
    const rgb: [number, number, number] = [10, 20, 30];
    // Untouched clean pixel keeps its exact value.
    const topFringe = 6 * SW + 9; // (9,6) top edge, structural
    expect(alpha[topFringe]).toBe(128);
    expect(res.masks![0][topFringe]).toBe(1);
    expect(res.alphas![0][topFringe]).toBe(128);
    const rgba = recolorWithMask(res.alphas![0], res.masks![0], rgb, SW, SH);
    expect(rgba[topFringe * 4 + 3]).toBe(128);
    // Every emitted alpha value is copied from the source glyph (same row or
    // column clean sample), never synthesized or binarized.
    const sourceValues = new Set(Array.from(alpha));
    for (let k = 0; k < 4; k++) {
      const out = recolorWithMask(res.alphas![k], res.masks![k], rgb, SW, SH);
      for (let i = 0; i < alpha.length; i++) {
        if (res.masks![k][i]) {
          expect(out[i * 4 + 3]).toBe(res.alphas![k][i]);
          expect(sourceValues.has(out[i * 4 + 3] as number)).toBe(true);
        } else {
          expect(out[i * 4 + 3]).toBe(0);
        }
      }
    }
    // Isolated noise has no directional continuity: hidden until S5.
    const noise = 5 * SW + 8; // (8,5)
    expect(alpha[noise]).toBe(77);
    expect(res.masks![0][noise]).toBe(0);
    expect(res.masks![3][noise]).toBe(0);
    expect(res.masks![4][noise]).toBe(1);
    expect(res.alphas![4][noise]).toBe(77);
  });

  function countComponents(mask: Uint8Array, w: number, h: number): number {
    const seen = new Uint8Array(w * h);
    let components = 0;
    const stack: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || seen[i]) continue;
      components++;
      stack.push(i);
      seen[i] = 1;
      while (stack.length > 0) {
        const cur = stack.pop() as number;
        const cx = cur % w;
        const cy = Math.floor(cur / w);
        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (mask[ni] && !seen[ni]) {
            seen[ni] = 1;
            stack.push(ni);
          }
        }
      }
    }
    return components;
  }

  test('S1 top bar thickness is continuous across the center (no block/nub)', () => {
    const alpha = buildSyntheticZhengAlpha();
    const res = analyzeZhengMasks(alpha, SW, SH);
    expect(res.valid).toBe(true);
    const [t0, t1] = res.meta!.top;
    const a1 = res.alphas![0];
    // Every row of the reconstructed top bar carries ink across the central
    // interval with the row's own clean level: no sudden thickening.
    for (let y = t0; y <= t1; y++) {
      let centerMin = 255;
      let sideMax = 0;
      for (let x = 8; x <= 31; x++) {
        const v = a1[y * SW + x];
        if (x >= 17 && x <= 21) {
          if (v > 0 && v < centerMin) centerMin = v;
        } else if (v > sideMax) {
          sideMax = v;
        }
      }
      expect(centerMin).toBeGreaterThan(0);
      expect(Math.abs(centerMin - sideMax)).toBeLessThanOrEqual(40);
    }
  });

  test('S1–S4 each form a single connected stroke (no isolated ghost blocks)', () => {
    const alpha = buildSyntheticZhengAlpha();
    const res = analyzeZhengMasks(alpha, SW, SH);
    expect(res.valid).toBe(true);
    for (let k = 0; k < 4; k++) {
      expect(countComponents(res.masks![k], SW, SH)).toBe(1);
    }
  });

  test('stroke ownership: state1 has no central nub (exact zero)', () => {
    const alpha = buildSyntheticZhengAlpha();
    const res = analyzeZhengMasks(alpha, SW, SH);
    expect(res.valid).toBe(true);
    const m1 = res.masks![0];
    // Central column below top band (rows 10-15, cols 18-20) belongs to stroke 2.
    for (let y = 10; y <= 15; y++) {
      for (let x = 18; x <= 20; x++) {
        expect(m1[y * SW + x]).toBe(0);
      }
    }
    // No ink at all below the top band in state 1.
    const top = res.meta!.top;
    for (let y = top[1] + 1; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        expect(m1[y * SW + x]).toBe(0);
      }
    }
  });

  test('stroke ownership: state3 has no left vertical body (exact zero)', () => {
    const alpha = buildSyntheticZhengAlpha();
    const res = analyzeZhengMasks(alpha, SW, SH);
    expect(res.valid).toBe(true);
    const m3 = res.masks![2];
    const m4 = res.masks![3];
    // Left spine mid-body (rows 22-28, cols 10-12) appears only at state4.
    for (let y = 22; y <= 28; y++) {
      for (let x = 10; x <= 12; x++) {
        if (alpha[y * SW + x] > 0) {
          expect(m3[y * SW + x]).toBe(0);
          expect(m4[y * SW + x]).toBe(1);
        }
      }
    }
  });

  test('stroke ownership: state4 has no bottom side arms (exact zero)', () => {
    const alpha = buildSyntheticZhengAlpha();
    const res = analyzeZhengMasks(alpha, SW, SH);
    expect(res.valid).toBe(true);
    const m4 = res.masks![3];
    const m5 = res.masks![4];
    // Bottom row away from verticals (row 32, cols 24-29) belongs to stroke 5.
    for (let x = 24; x <= 29; x++) {
      const idx = 32 * SW + x;
      if (alpha[idx] > 0) {
        expect(m4[idx]).toBe(0);
        expect(m5[idx]).toBe(1);
      }
    }
  });

  test('empty/unrasterized alpha is invalid fallback, does not throw', () => {
    const empty = new Uint8Array(SW * SH);
    let res;
    expect(() => {
      res = analyzeZhengMasks(empty, SW, SH);
    }).not.toThrow();
    expect(res!.valid).toBe(false);
  });
});

describe('progressive-zheng: DPR backing resolution', () => {
  test('DPR=1 backing equals CSS size; DPR=2 backing is ~2x (high-DPI separation)', () => {
    const css = 24;
    const dpr1 = computeBackingSize(css, 1);
    const dpr2 = computeBackingSize(css, 2);
    expect(dpr1.width).toBeGreaterThanOrEqual(24);
    expect(dpr1.height).toBeGreaterThanOrEqual(24);
    expect(dpr2.width).toBeGreaterThanOrEqual(47);
    expect(dpr2.height).toBeGreaterThanOrEqual(47);
    expect(dpr2.width).toBeGreaterThan(dpr1.width);
  });
});

describe('progressive-zheng: color / mask cache separation', () => {
  test('color does not affect glyph/mask cache identity', () => {
    const a: ZhengTypography = { ...baseTypo, color: 'rgb(0, 0, 0)' };
    const b: ZhengTypography = { ...baseTypo, color: 'rgb(255, 255, 255)' };
    expect(buildMaskCacheKey(a)).toBe(buildMaskCacheKey(b));
  });

  test('font/size/weight/style/DPR changes invalidate mask cache', () => {
    const k0 = buildMaskCacheKey(baseTypo);
    expect(buildMaskCacheKey({ ...baseTypo, fontFamily: 'Microsoft YaHei, sans-serif' })).not.toBe(k0);
    expect(buildMaskCacheKey({ ...baseTypo, fontSize: '32px' })).not.toBe(k0);
    expect(buildMaskCacheKey({ ...baseTypo, fontWeight: '700' })).not.toBe(k0);
    expect(buildMaskCacheKey({ ...baseTypo, fontStyle: 'italic' })).not.toBe(k0);
    expect(buildMaskCacheKey({ ...baseTypo, devicePixelRatio: 2 })).not.toBe(k0);
  });

  test('at least three representative Chinese font-family inputs do not use fixed-font path', () => {
    const families = [
      'SimSun, serif',
      '"Microsoft YaHei", sans-serif',
      '"Kaiti SC", Kaiti, KaiTi, serif',
    ];
    const keys = families.map((f) => buildMaskCacheKey({ ...baseTypo, fontFamily: f }));
    expect(new Set(keys).size).toBe(3);
    for (let i = 0; i < families.length; i++) {
      expect(keys[i]).toContain(families[i]);
    }
    const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.ts'), 'utf8');
    expect(rendererSrc).not.toMatch(/PARTIAL_GLYPHS/);
    expect(rendererSrc).not.toMatch(/['"]一['"]/);
    expect(rendererSrc).not.toMatch(/['"]丁['"]/);
    expect(rendererSrc).not.toMatch(/['"]下['"]/);
    expect(rendererSrc).not.toMatch(/<svg/i);
    expect(rendererSrc).not.toMatch(/1D37/);
    const progSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'zheng-progressive.ts'), 'utf8');
    expect(progSrc).toContain('正');
    expect(progSrc).not.toMatch(/['"]一['"]/);
    expect(progSrc).not.toMatch(/['"]丁['"]/);
  });

  test('color change recolors with same mask/alpha (light + dark text colors)', () => {
    const alpha = buildSyntheticZhengAlpha();
    const res = analyzeZhengMasks(alpha, SW, SH);
    const mask3 = res.masks![2];
    const black = parseCssColor('rgb(0, 0, 0)')!;
    const white = parseCssColor('rgb(255, 255, 255)')!;
    expect(black).toEqual([0, 0, 0]);
    expect(white).toEqual([255, 255, 255]);
    const outBlack = recolorWithMask(alpha, mask3, black, SW, SH);
    const outWhite = recolorWithMask(alpha, mask3, white, SW, SH);
    let checked = 0;
    for (let i = 0; i < alpha.length; i++) {
      if (mask3[i] && alpha[i] > 0) {
        expect(outBlack[i * 4 + 3]).toBe(alpha[i]);
        expect(outWhite[i * 4 + 3]).toBe(alpha[i]);
        expect([outBlack[i * 4], outBlack[i * 4 + 1], outBlack[i * 4 + 2]]).toEqual([0, 0, 0]);
        expect([outWhite[i * 4], outWhite[i * 4 + 1], outWhite[i * 4 + 2]]).toEqual([255, 255, 255]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('progressive-zheng: true inline chip DOM + theme', () => {
  const mockHost = (color = 'rgb(0, 0, 0)') => {
    const dom = document.createElement('div');
    dom.style.fontFamily = 'SimSun, serif';
    dom.style.fontSize = '24px';
    dom.style.fontWeight = '400';
    dom.style.fontStyle = 'normal';
    dom.style.color = color;
    document.body.appendChild(dom);
    const editor = {
      getCursor: () => ({ line: 0, ch: 0 }),
      posToOffset: () => 0,
      replaceRange: jest.fn(),
      cm: {
        dom,
        coordsAtPos: () => ({ left: 100, top: 100, bottom: 120 }),
      },
    } as unknown as import('obsidian').Editor;
    const host = resolveEditorHost(editor)!;
    expect(host).not.toBeNull();
    return { dom, editor, host };
  };

  const chipFor = (n: number, color = 'rgb(0, 0, 0)') => {
    const { host } = mockHost(color);
    return buildTallyChip(n, host.typography, null);
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('true inline chip participates in layout (not absolute/fixed)', () => {
    const chip = chipFor(3);
    expect(chip.className).toContain('zheng-tally-inline');
    expect(chip.style.position).not.toBe('absolute');
    expect(chip.style.position).not.toBe('fixed');
    expect(chip.querySelector('[data-state="3"]')).not.toBeNull();
  });

  test('chip build does not throw when rasterization is unavailable (jsdom fallback [N])', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      let el: HTMLElement | null = null;
      expect(() => {
        el = chipFor(n);
      }).not.toThrow();
      expect(el!).not.toBeNull();
    }
  });

  test('states 1-5 render canonical vector strokes (no 一/丁/下 text)', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const el = chipFor(n);
      const svg = el.querySelector('svg.zt-svg');
      expect(svg).not.toBeNull();
      expect(svg!.querySelectorAll('path').length).toBe(n);
      const text = el.textContent || '';
      expect(text).not.toContain('一');
      expect(text).not.toContain('丁');
      expect(text).not.toContain('下');
    }
  });

  test('inline CSS contains no hardcoded light/dark backgrounds and no fixed overlay', () => {
    const el = chipFor(2);
    const css = `${el.innerHTML} ${el.style.cssText}`;
    expect(css).not.toMatch(/#fff/i);
    expect(css).not.toMatch(/#fafafa/i);
    expect(css).not.toMatch(/#ccc/i);
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.ts'), 'utf8');
    expect(src).toContain('--background-secondary');
    expect(src).toContain('--background-modifier-border');
    expect(src).not.toMatch(/--background-secondary,\s*#[0-9a-fA-F]{3,6}/);
    expect(src).not.toMatch(/--background-modifier-border,\s*#[0-9a-fA-F]{3,6}/);
    // Normal chip must not be positioned; fixed only in explicit fallback.
    expect(el.style.position).not.toBe('absolute');
    expect(el.style.position).not.toBe('fixed');
    const rendererSrc = src;
    expect(rendererSrc).toContain('data-fallback-mode');
  });

  test('count <= 15 shows every group; count 18 compacts but keeps total', () => {
    const el8 = chipFor(8);
    expect(el8.querySelectorAll('[data-full="true"]').length).toBe(1);
    expect(el8.querySelector('[data-state="3"]')).not.toBeNull();
    expect(el8.querySelector('.zt-ellipsis')).toBeNull();
    expect(el8.querySelector('.zt-total')?.textContent).toBe('8');
    const el18 = chipFor(18);
    expect(el18.querySelectorAll('[data-full="true"]').length).toBe(2);
    expect(el18.querySelector('.zt-ellipsis')).not.toBeNull();
    expect(el18.querySelector('[data-state="3"]')).not.toBeNull();
    expect(el18.querySelector('.zt-total')?.textContent).toBe('18');
    expect(el18.getAttribute('data-count')).toBe('18');
    const text = el18.textContent || '';
    expect(text).not.toContain('下');
    expect(text).not.toContain('一');
    expect(text).not.toContain('丁');
  });

  test('fallback chip is explicit text (catastrophic path only)', () => {
    const { host } = mockHost();
    const el = buildFallbackChip(3, host.typography);
    expect(el.getAttribute('data-fallback')).toBe('text');
  });

  test('production normal path has no absolute/fixed inline positioning', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.ts'), 'utf8');
    // buildTallyChip (normal path) must not set absolute/fixed positioning.
    const chipStart = src.indexOf('export function buildTallyChip');
    const fallbackStart = src.indexOf('export function createFallbackOverlayRenderer');
    const chipFn = src.slice(chipStart, fallbackStart);
    const fallbackFn = src.slice(fallbackStart);
    expect(chipFn).not.toMatch(/position\s*:\s*absolute/);
    expect(chipFn).not.toMatch(/position\s*:\s*fixed/);
    expect(fallbackFn).toMatch(/data-fallback-mode/);
  });

  test('readHostTypography reads family/size/weight/style/color + DPR', () => {
    const { dom } = mockHost('rgb(255, 255, 255)');
    const typo = readHostTypography(dom);
    expect(typo).not.toBeNull();
    expect(typo!.fontFamily).toBeTruthy();
    expect(typo!.fontSize).toBeTruthy();
    expect(typo!.color).toBeTruthy();
    expect(typeof typo!.devicePixelRatio).toBe('number');
  });
});
