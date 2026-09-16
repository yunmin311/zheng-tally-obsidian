import * as fs from 'fs';
import * as path from 'path';
import {
  ZHENG_FLIP_TRANSFORM,
  ZHENG_MEDIANS,
  ZHENG_STROKES,
  ZHENG_STROKE_COUNT,
  ZHENG_VIEWBOX,
} from '../src/zheng-strokes';
import { buildTallyChip } from '../src/renderer';
import { CountBadge, parseStableTokens, tallyHoverExtension } from '../src/tally-hover';
import type { ZhengTypography } from '../src/zheng-progressive';

const typo = (overrides: Partial<ZhengTypography> = {}): ZhengTypography => ({
  fontFamily: 'SimSun, serif',
  fontSize: '24px',
  fontWeight: '400',
  fontStyle: 'normal',
  color: 'rgb(0, 0, 0)',
  devicePixelRatio: 1,
  ...overrides,
});

describe('vector-tally: canonical data integrity', () => {
  test('exactly 5 strokes in canonical order 横/竖/横/竖/横', () => {
    expect(ZHENG_STROKE_COUNT).toBe(5);
    expect(ZHENG_STROKES).toHaveLength(5);
    for (const d of ZHENG_STROKES) {
      expect(typeof d).toBe('string');
      expect(d.length).toBeGreaterThan(20);
      expect(d.startsWith('M ')).toBe(true);
      expect(d.endsWith(' Z')).toBe(true);
    }
    // Medians run top-to-bottom in y-up space: stroke 1 highest, stroke 5 lowest.
    expect(ZHENG_MEDIANS).toHaveLength(5);
    const meanY = ZHENG_MEDIANS.map(
      (pts) => pts.reduce((s, p) => s + p[1], 0) / pts.length,
    );
    expect(meanY[0]).toBeGreaterThan(meanY[1]);
    expect(meanY[2]).toBeGreaterThan(meanY[4]);
    expect(meanY[3]).toBeGreaterThan(meanY[4]);
    expect(ZHENG_VIEWBOX).toBe('0 0 900 900');
    expect(ZHENG_FLIP_TRANSFORM).toContain('scale(1,-1)');
  });

  test('no network in vector path', () => {
    for (const f of ['renderer.ts', 'cm6-widget.ts', 'editor-session.ts', 'tally-hover.ts', 'zheng-strokes.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
      expect(src).not.toMatch(/fetch\s*\(/);
      expect(src).not.toMatch(/cdn\.jsdelivr/);
      expect(src).not.toMatch(/XMLHttpRequest/);
    }
  });
});

describe('vector-tally: native sizing glyph', () => {
  test('each glyph pairs hidden native 正 with same-cell SVG overlay', () => {
    const chip = buildTallyChip(3, typo(), null);
    const glyph = chip.querySelector('.zt-glyph') as HTMLElement | null;
    expect(glyph).not.toBeNull();
    const native = glyph!.querySelector('.zt-native') as HTMLElement | null;
    expect(native).not.toBeNull();
    expect(native!.textContent).toBe('正');
    expect(native!.style.visibility).toBe('hidden');
    const svg = glyph!.querySelector('svg.zt-svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 900 900');
    // Same grid cell stacking, svg fills the native-measured cell.
    expect(native!.style.gridArea).toBe('cell');
    expect((svg as unknown as HTMLElement).style.gridArea).toBe('cell');
    expect((svg as unknown as HTMLElement).style.width).toBe('100%');
    expect((svg as unknown as HTMLElement).style.height).toBe('100%');
  });

  test('no fixed 1em frame decides the glyph box', () => {
    const chip = buildTallyChip(5, typo(), null);
    const html = chip.innerHTML;
    expect(html).not.toMatch(/width:\s*1em/);
    expect(html).not.toMatch(/height:\s*1em/);
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.ts'), 'utf8');
    const chipFn = src.slice(src.indexOf('export function buildVectorGlyph'), src.indexOf('export function buildTallyChip'));
    expect(chipFn).not.toMatch(/1em/);
  });

  test('svg intrinsic sizing is suppressed so native 正 decides the box', () => {
    const chip = buildTallyChip(3, typo(), null);
    const svg = chip.querySelector('svg.zt-svg') as unknown as HTMLElement;
    // Width/height fill the native-measured cell, min-zero + containment
    // suppress the SVG default 300x150 intrinsic contribution.
    expect(svg.style.minWidth).toBe('0');
    expect(svg.style.minHeight).toBe('0');
    expect(svg.style.overflow).toBe('hidden');
    expect(svg.style.contain).toContain('size');
    const native = chip.querySelector('.zt-native') as HTMLElement;
    expect(native.style.visibility).toBe('hidden');
    expect(native.style.gridArea).toBe('cell');
    // No fixed px frame anywhere in the glyph path.
    expect(chip.innerHTML).not.toMatch(/300px/);
  });

  test('glyph inherits editor typography (family/color), strokes use currentColor', () => {
    const chip = buildTallyChip(2, typo({ fontFamily: 'KaiTi, serif', color: 'rgb(10, 20, 30)' }), null);
    const native = chip.querySelector('.zt-native') as HTMLElement;
    expect(native.style.fontFamily).toContain('KaiTi');
    expect(native.style.color).toContain('10, 20, 30');
    const group = chip.querySelector('svg g');
    expect(group?.getAttribute('fill')).toBe('currentColor');
  });
});

describe('vector-tally: large-count behavior', () => {
  test('count <= 15 shows every group, total always present', () => {
    for (const n of [0, 1, 5, 8, 15]) {
      const chip = buildTallyChip(n, typo(), null);
      const q = Math.floor(n / 5);
      const r = n % 5;
      expect(chip.querySelectorAll('[data-full="true"]').length).toBe(q);
      expect(chip.querySelector('.zt-ellipsis')).toBeNull();
      if (r > 0) expect(chip.querySelector(`[data-state="${r}"]`)).not.toBeNull();
      expect(chip.querySelector('.zt-total')?.textContent).toBe(String(n));
      expect(chip.getAttribute('data-count')).toBe(String(n));
    }
  });

  test('count 83 compacts: 2 leading + ellipsis + partial + total 83', () => {
    const chip = buildTallyChip(83, typo(), null);
    expect(chip.querySelectorAll('[data-full="true"]').length).toBe(2);
    expect(chip.querySelector('.zt-ellipsis')).not.toBeNull();
    expect(chip.querySelector('[data-state="3"]')).not.toBeNull();
    expect(chip.querySelector('.zt-total')?.textContent).toBe('83');
    expect(chip.getAttribute('data-count')).toBe('83');
  });

  test('count total styling contracts (0.72-0.78em, dimmed, tabular, themed)', () => {
    const chip = buildTallyChip(18, typo(), null);
    const total = chip.querySelector('.zt-total') as HTMLElement;
    expect(total.style.fontSize).toBe('0.75em');
    expect(Number.parseFloat(total.style.opacity)).toBeLessThan(0.8);
    expect(total.style.fontVariantNumeric).toContain('tabular-nums');
  });

  test('floors at zero, no negative groups', () => {
    const chip = buildTallyChip(-4, typo(), null);
    expect(chip.querySelectorAll('.zt-tally').length).toBe(0);
    expect(chip.querySelector('.zt-total')?.textContent).toBe('0');
  });
});

describe('vector-tally: hover count badge', () => {
  test('parseStableTokens maps formats to counts', () => {
    expect(parseStableTokens('正正正·3', 10)).toEqual([{ from: 10, to: 15, count: 18 }]);
    expect(parseStableTokens('·2', 0)).toEqual([{ from: 0, to: 2, count: 2 }]);
    expect(parseStableTokens('正正', 5)).toEqual([{ from: 5, to: 7, count: 10 }]);
    expect(parseStableTokens('正·1', 0)).toEqual([{ from: 0, to: 3, count: 6 }]);
    // Lone bare 正 is prose-ambiguous: never badged.
    expect(parseStableTokens('正在', 0)).toEqual([]);
    expect(parseStableTokens('正确', 0)).toEqual([]);
    expect(parseStableTokens('hello', 0)).toEqual([]);
  });

  test('CountBadge renders themed count, ignores events', () => {
    const badge = new CountBadge(18);
    const el = badge.toDOM();
    expect(el.className).toContain('zt-count-badge');
    expect(el.textContent).toBe('18');
    expect(badge.eq(new CountBadge(18))).toBe(true);
    expect(badge.eq(new CountBadge(8))).toBe(false);
    expect(badge.ignoreEvent()).toBe(true);
  });

  test('hover extension is defined and side-effect free to import', () => {
    expect(tallyHoverExtension).toBeDefined();
    expect(Array.isArray(tallyHoverExtension)).toBe(true);
  });

  test('hover badge is a transient overlay, never an inline widget (no layout shift)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'tally-hover.ts'), 'utf8');
    // No inline widget insertion: badge must not occupy editor layout.
    expect(src).not.toMatch(/Decoration\.widget/);
    // Anchored transient overlay instead.
    expect(src).toContain('zt-count-badge-popup');
    expect(src).toMatch(/position.+fixed/);
    expect(src).toContain('document.body.appendChild');
    // Anchoring is deferred past the update transaction (sync measurement
    // inside update() can return null); never blocks on rAF.
    expect(src).toMatch(/setTimeout/);
    expect(src).not.toMatch(/requestAnimationFrame/);
  });
});

describe('vector-tally: production independence from raster guessing', () => {
  const productionFiles = [
    'renderer.ts',
    'editor-session.ts',
    'main.ts',
    'cm6-widget.ts',
    'editor-host.ts',
    'tally-hover.ts',
  ];

  test.each(productionFiles)('%s never calls dynamic stroke guessing', (f) => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    expect(src).not.toMatch(/analyzeZhengMasks/);
    expect(src).not.toMatch(/nearest-centerline|distToHSeg|distToVSeg/i);
    expect(src).not.toMatch(/run-length|Hcand|Vcand/i);
    expect(src).not.toMatch(/rasterizeZhengAlpha|buildGlyphCache/);
  });

  test('production files use canonical vectors, not fixed SVG tally shapes', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.ts'), 'utf8');
    expect(src).toContain('ZHENG_STROKES');
    expect(src).not.toMatch(/['"]一['"]/);
    expect(src).not.toMatch(/['"]丁['"]/);
    expect(src).not.toMatch(/['"]下['"]/);
  });
});

describe('vector-tally: license handling', () => {
  test('Arphic license vendored with attribution, data not claimed as MIT', () => {
    const license = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'ARPHICPL.txt'), 'utf8');
    expect(license).toContain('ARPHIC PUBLIC LICENSE');
    expect(license).toContain('Arphic Technology');
    const notes = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'README.md'), 'utf8');
    expect(notes).toMatch(/Arphic/i);
    expect(notes).toMatch(/NOT MIT|not MIT/i);
    const strokes = fs.readFileSync(path.join(__dirname, '..', 'src', 'zheng-strokes.ts'), 'utf8');
    expect(strokes).toMatch(/Arphic/);
    expect(strokes).toMatch(/NOT MIT|not MIT/i);
  });
});
