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
import { createTallyRenderer, readEditorTypography } from '../src/renderer';
import type { Editor } from 'obsidian';

// ---------------------------------------------------------------------------
// Synthetic 正 alpha bitmap (pure, no canvas/font rasterization).
// This is the deterministic stand-in for "current-font 正 glyph alpha"
// when jsdom cannot provide real Canvas font rasterization.
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
  // Anti-aliased fringe: partial alpha must be preserved, never binarized.
  set(8, 5, 128);
  set(31, 5, 96);
  set(7, 7, 64);
  set(32, 32, 140);
  set(9, 30, 110);
  set(20, 5, 77);
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
    // Superset: every pixel in mask N-1 must also be in mask N
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
    // Sanity: synthetic contains partial-alpha fringe
    const partial = Array.from(alpha).filter((v) => v > 0 && v < 255);
    expect(partial.length).toBeGreaterThan(0);
    const res = analyzeZhengMasks(alpha, SW, SH);
    expect(res.valid).toBe(true);
    const rgb: [number, number, number] = [10, 20, 30];
    // Find a fringe pixel that is included in state 1 (top edge)
    const fringeIdx = 5 * SW + 8; // (8,5) alpha 128, part of top Heng fringe
    expect(alpha[fringeIdx]).toBe(128);
    expect(res.masks![0][fringeIdx]).toBe(1);
    const rgba = recolorWithMask(alpha, res.masks![0], rgb, SW, SH);
    expect(rgba[fringeIdx * 4 + 3]).toBe(128);
    // Included partial-alpha pixels keep exact value across all states
    for (const mask of res.masks!) {
      const out = recolorWithMask(alpha, mask, rgb, SW, SH);
      for (let i = 0; i < alpha.length; i++) {
        if (mask[i] && alpha[i] > 0 && alpha[i] < 255) {
          expect(out[i * 4 + 3]).toBe(alpha[i]);
        }
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
    // Distinct keys prove the input family is part of identity (no fixed-font collapse)
    expect(new Set(keys).size).toBe(3);
    for (let i = 0; i < families.length; i++) {
      expect(keys[i]).toContain(families[i]);
    }
    // Renderer source must not hardcode a fixed preview font or SVG/tally-glyph source
    const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.ts'), 'utf8');
    expect(rendererSrc).not.toMatch(/PARTIAL_GLYPHS/);
    expect(rendererSrc).not.toMatch(/['"]一['"]/);
    expect(rendererSrc).not.toMatch(/['"]丁['"]/);
    expect(rendererSrc).not.toMatch(/['"]下['"]/);
    expect(rendererSrc).not.toMatch(/<svg/i);
    expect(rendererSrc).not.toMatch(/1D37/);
    // Progressive module must reference only 普通汉字 正 as glyph source
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
    // Same alpha channel, different RGB where ink exists
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

describe('progressive-zheng: renderer DOM + theme', () => {
  const mockEditor = (color = 'rgb(0, 0, 0)') => {
    const el = document.createElement('div');
    el.style.fontFamily = 'SimSun, serif';
    el.style.fontSize = '24px';
    el.style.fontWeight = '400';
    el.style.fontStyle = 'normal';
    el.style.color = color;
    document.body.appendChild(el);
    return {
      el,
      editor: {
        cm: { wrapperElement: el },
        getCursor: () => ({ line: 0, ch: 0 }),
        replaceRange: jest.fn(),
      } as unknown as Editor,
    };
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('fallback does not throw when rasterization is unavailable (jsdom)', () => {
    const { el, editor } = mockEditor();
    let renderer;
    expect(() => {
      renderer = createTallyRenderer(editor);
    }).not.toThrow();
    const host = document.createElement('div');
    document.body.appendChild(host);
    expect(() => renderer!.mount(host)).not.toThrow();
    for (const n of [1, 2, 3, 4, 5]) {
      expect(() => renderer!.update(n)).not.toThrow();
    }
    expect(() => renderer!.destroy()).not.toThrow();
    el.remove();
  });

  test('states 1-3 never render 一/丁/下; states use canvas or explicit [N] fallback', () => {
    const { el, editor } = mockEditor();
    const renderer = createTallyRenderer(editor);
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderer.mount(host);
    for (const n of [1, 2, 3]) {
      renderer.update(n);
      const text = host.textContent || '';
      expect(text).not.toContain('一');
      expect(text).not.toContain('丁');
      expect(text).not.toContain('下');
      // Either a progressive canvas exists or an explicit fallback marker
      const hasCanvas = host.querySelector('canvas') !== null;
      const hasFallback = text.includes(`[${n}]`);
      expect(hasCanvas || hasFallback).toBe(true);
    }
    renderer.destroy();
    el.remove();
  });

  test('overlay CSS contains no hardcoded light/dark backgrounds', () => {
    const { el, editor } = mockEditor();
    const renderer = createTallyRenderer(editor);
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderer.mount(host);
    const inner = host.querySelector('div > div') as HTMLElement | null;
    expect(inner).not.toBeNull();
    const css = `${inner!.style.cssText} ${host.innerHTML}`;
    expect(css).not.toMatch(/#fff/i);
    expect(css).not.toMatch(/#000/i);
    expect(css).not.toMatch(/#fafafa/i);
    expect(css).not.toMatch(/#ccc/i);
    // Panel must use Obsidian variables
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.ts'), 'utf8');
    expect(src).toContain('--background-secondary');
    expect(src).toContain('--background-modifier-border');
    // No hardcoded hex fallback for panel bg/border
    expect(src).not.toMatch(/--background-secondary,\s*#[0-9a-fA-F]{3,6}/);
    expect(src).not.toMatch(/--background-modifier-border,\s*#[0-9a-fA-F]{3,6}/);
    renderer.destroy();
    el.remove();
  });

  test('count 18 renders three complete 正 + progressive state 3 (no 一/丁/下)', () => {
    const { el, editor } = mockEditor();
    const renderer = createTallyRenderer(editor);
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderer.mount(host);
    renderer.update(18);
    const fulls = host.querySelectorAll('[data-full="true"]');
    const partial = host.querySelector('[data-state="3"]');
    expect(fulls.length).toBe(3);
    expect(partial).not.toBeNull();
    const text = host.textContent || '';
    expect(text).not.toContain('下');
    expect(text).not.toContain('一');
    expect(text).not.toContain('丁');
    renderer.destroy();
    el.remove();
  });

  test('readEditorTypography reads family/size/weight/style/color + DPR', () => {
    const { el, editor } = mockEditor('rgb(255, 255, 255)');
    const typo = readEditorTypography(editor);
    expect(typo.fontFamily).toBeTruthy();
    expect(typo.fontSize).toBeTruthy();
    expect(typo.fontWeight).toBeTruthy();
    expect(typo.fontStyle).toBeTruthy();
    expect(typo.color).toBeTruthy();
    expect(typeof typo.devicePixelRatio).toBe('number');
    expect(typo.devicePixelRatio).toBeGreaterThan(0);
    el.remove();
  });
});
