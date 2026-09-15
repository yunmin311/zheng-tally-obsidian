import { resolveEditorHost } from '../src/editor-host';
import type { Editor, EditorPosition } from 'obsidian';

const makeDom = (color = 'rgb(0, 0, 0)'): HTMLElement => {
  const el = document.createElement('div');
  el.style.fontFamily = 'SimSun, serif';
  el.style.fontSize = '24px';
  el.style.fontWeight = '400';
  el.style.fontStyle = 'normal';
  el.style.color = color;
  document.body.appendChild(el);
  return el;
};

const makeEditor = (opts: {
  dom?: HTMLElement;
  offset?: number;
  coords?: { left: number; top: number; bottom: number };
  cursor?: EditorPosition;
  posToOffsetThrows?: boolean;
  coordsThrows?: boolean;
} = {}): Editor => {
  const dom = opts.dom ?? makeDom();
  const cursor = opts.cursor ?? { line: 0, ch: 0 };
  return {
    getCursor: () => cursor,
    posToOffset: opts.posToOffsetThrows
      ? () => {
          throw new Error('offset fail');
        }
      : () => opts.offset ?? 0,
    replaceRange: jest.fn(),
    cm: {
      dom,
      coordsAtPos: opts.coordsThrows
        ? () => {
            throw new Error('coords fail');
          }
        : () => opts.coords ?? { left: 100, top: 100, bottom: 120 },
    },
  } as unknown as Editor;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('editor-host CM6 adapter', () => {
  test('resolves offset, coords and dom from CM6 shape', () => {
    const dom = makeDom();
    const editor = makeEditor({ dom, offset: 5, coords: { left: 10, top: 20, bottom: 30 } });
    const host = resolveEditorHost(editor);
    expect(host).not.toBeNull();
    expect(host!.offset).toBe(5);
    expect(host!.coords).toEqual({ left: 10, top: 20, bottom: 30 });
    expect(host!.dom).toBe(dom);
    expect(host!.typography.fontFamily).toBeTruthy();
  });

  test('fail-closed when posToOffset throws', () => {
    const editor = makeEditor({ posToOffsetThrows: true });
    expect(resolveEditorHost(editor)).toBeNull();
  });

  test('fail-closed when coordsAtPos throws', () => {
    const editor = makeEditor({ coordsThrows: true });
    expect(resolveEditorHost(editor)).toBeNull();
  });

  test('fail-closed when dom missing', () => {
    const editor = {
      getCursor: () => ({ line: 0, ch: 0 }),
      posToOffset: () => 0,
      replaceRange: jest.fn(),
      cm: {},
    } as unknown as Editor;
    expect(resolveEditorHost(editor)).toBeNull();
  });

  test('fail-closed on legacy wrapperElement shape (no dom/coords(number))', () => {
    const legacy = {
      getCursor: () => ({ line: 0, ch: 0 }),
      replaceRange: jest.fn(),
      cm: {
        wrapperElement: document.body,
        coordsAtPos: () => ({ left: 1, top: 1, bottom: 2 }),
      },
    } as unknown as Editor;
    // No posToOffset -> must fail, production no longer supports legacy shape.
    expect(resolveEditorHost(legacy)).toBeNull();
  });

  test('production src has single CM access point (no wrapperElement outside host)', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const srcDir = path.join(__dirname, '..', 'src');
    const files = ['editor-session.ts', 'renderer.ts', 'main.ts', 'tally-state.ts', 'settings.ts'];
    for (const f of files) {
      const src = fs.readFileSync(path.join(srcDir, f), 'utf8');
      expect(src).not.toMatch(/wrapperElement/);
    }
    // Only editor-host may touch editor.cm / coordsAtPos
    for (const f of ['editor-session.ts', 'renderer.ts']) {
      const src = fs.readFileSync(path.join(srcDir, f), 'utf8');
      expect(src).not.toMatch(/\.cm\b/);
      expect(src).not.toMatch(/coordsAtPos/);
    }
    const hostSrc = fs.readFileSync(path.join(srcDir, 'editor-host.ts'), 'utf8');
    expect(hostSrc).toContain('posToOffset');
    expect(hostSrc).toContain('coordsAtPos');
  });
});
