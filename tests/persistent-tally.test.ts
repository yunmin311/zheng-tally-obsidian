import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createEditorSession } from '../src/editor-session';
import { tallyExtension } from '../src/cm6-widget';
import {
  collectPersistedTokens,
  createPersistentTallyExtension,
  createPersistentTallyField,
  findResumeToken,
} from '../src/persistent-tally';
import { parseMarkedTallies, stableTextForCount, toMarkedText } from '../src/tally-state';
import { buildTallyChip } from '../src/renderer';
import { parseStableTokens, stableTokensWithoutMarked } from '../src/tally-hover';
import type { ZhengTypography } from '../src/zheng-progressive';
import type {
  Editor,
  EditorPosition,
  EventRef,
  MarkdownView,
  Workspace,
  WorkspaceLeaf,
} from 'obsidian';

const typo = (overrides: Partial<ZhengTypography> = {}): ZhengTypography => ({
  fontFamily: 'SimSun, serif',
  fontSize: '24px',
  fontWeight: '400',
  fontStyle: 'normal',
  color: 'rgb(0, 0, 0)',
  devicePixelRatio: 1,
  ...overrides,
});

describe('persistent-tally: marked storage format', () => {
  test.each([
    [1, '·1<!--zt:1-->'],
    [4, '·4<!--zt:4-->'],
    [5, '正<!--zt:5-->'],
    [7, '正·2<!--zt:7-->'],
    [10, '正正<!--zt:10-->'],
    [18, '正正正·3<!--zt:18-->'],
  ])('count %i persists as %s', (count, expected) => {
    expect(toMarkedText(count)).toBe(expected);
  });

  test('count 0 is never persisted', () => {
    expect(toMarkedText(0)).toBe('');
    expect(toMarkedText(-3)).toBe('');
  });

  test('verified parse accepts exact marker pairs', () => {
    expect(parseMarkedTallies('正正正·3<!--zt:18-->', 0)).toEqual([
      { from: 0, to: 17, count: 18 },
    ]);
    expect(parseMarkedTallies('·1<!--zt:1-->', 5)).toEqual([{ from: 5, to: 18, count: 1 }]);
    expect(parseMarkedTallies('正<!--zt:5-->', 0)).toEqual([{ from: 0, to: 12, count: 5 }]);
  });

  test('marker mismatch fails closed', () => {
    expect(parseMarkedTallies('正正<!--zt:7-->', 0)).toEqual([]);
    expect(parseMarkedTallies('正正正·3<!--zt:19-->', 0)).toEqual([]);
    expect(parseMarkedTallies('·2<!--zt:3-->', 0)).toEqual([]);
  });

  test('ordinary HTML comments are unaffected', () => {
    expect(parseMarkedTallies('<!-- hello --> 正正', 0)).toEqual([]);
    expect(parseMarkedTallies('正<!-- hi -->', 0)).toEqual([]);
    expect(parseMarkedTallies('正正 <!--zt:10-->', 0)).toEqual([]);
  });

  test('lone 正 without marker is not owned', () => {
    expect(parseMarkedTallies('正', 0)).toEqual([]);
    expect(parseMarkedTallies('正在吃饭', 0)).toEqual([]);
  });

  test('stableTextForCount matches committed serializer', () => {
    expect(stableTextForCount(18)).toBe('正正正·3');
    expect(stableTextForCount(5)).toBe('正');
  });
});

describe('persistent-tally: persisted chip reuses canonical vectors', () => {
  const persistedChip = (n: number) => buildTallyChip(n, typo(), null, 'persisted', false);

  test('count 1 persisted renders vector state 1', () => {
    const el = persistedChip(1);
    expect(el.querySelector('[data-state="1"]')).not.toBeNull();
    expect(el.querySelectorAll('svg.zt-svg path').length).toBe(1);
  });

  test('count 4 persisted renders vector state 4', () => {
    const el = persistedChip(4);
    expect(el.querySelector('[data-state="4"]')).not.toBeNull();
    expect(el.querySelectorAll('svg.zt-svg path').length).toBe(4);
  });

  test('count 5 persisted renders one full vector', () => {
    const el = persistedChip(5);
    expect(el.querySelectorAll('[data-full="true"]').length).toBe(1);
    expect(el.querySelectorAll('svg.zt-svg path').length).toBe(5);
  });

  test('count 7 persisted renders full-5 plus state-2', () => {
    const el = persistedChip(7);
    expect(el.querySelectorAll('[data-full="true"]').length).toBe(1);
    expect(el.querySelector('[data-state="2"]')).not.toBeNull();
  });

  test('count 18 persisted keeps canonical compact vectors (never text)', () => {
    const el = persistedChip(18);
    expect(el.querySelectorAll('[data-full="true"]').length).toBe(2);
    expect(el.querySelector('.zt-ellipsis')).not.toBeNull();
    expect(el.querySelector('[data-state="3"]')).not.toBeNull();
    expect(el.querySelector('.zt-total')?.textContent).toBe('18');
    expect(el.textContent).not.toContain('正正正·3');
  });

  test('no visible ·3 remainder inside persisted widget', () => {
    for (const n of [3, 8, 18, 23]) {
      expect(persistedChip(n).textContent).not.toContain('·');
    }
  });

  test('persisted chrome is quiet but structurally identical', () => {
    const el = persistedChip(18);
    expect(el.getAttribute('data-mode')).toBe('persisted');
    expect(el.getAttribute('data-count')).toBe('18');
    expect((el.querySelector('.zt-total') as HTMLElement).style.visibility).toBe('hidden');
    const active = buildTallyChip(18, typo(), null);
    expect(active.getAttribute('data-mode')).toBe('active');
    expect((active.querySelector('.zt-total') as HTMLElement).style.visibility).not.toBe('hidden');
    expect(active.querySelectorAll('.zt-glyph').length).toBe(el.querySelectorAll('.zt-glyph').length);
  });
});

describe('persistent-tally: resume lookup', () => {
  test('marked token resumes inside and adjacent', () => {
    const doc = 'AA 正正<!--zt:10--> BB';
    expect(findResumeToken(doc, 6)).toEqual({ from: 3, to: 17, count: 10, legacy: false });
    expect(findResumeToken(doc, 2)).toEqual({ from: 3, to: 17, count: 10, legacy: false });
    expect(findResumeToken(doc, 18)).toEqual({ from: 3, to: 17, count: 10, legacy: false });
    expect(findResumeToken(doc, 0)).toBeNull();
  });

  test('legacy token resumes only when uniquely containing', () => {
    expect(findResumeToken('foo 正正 bar', 5)).toEqual({ from: 4, to: 6, count: 10, legacy: true });
    expect(findResumeToken('foo 正正 bar', 0)).toBeNull();
    expect(findResumeToken('正在吃饭', 0)).toBeNull();
  });

  test('marked ranges are not legacy-resumable', () => {
    const doc = 'a 正正正·3<!--zt:18--> b';
    const hit = findResumeToken(doc, 4);
    expect(hit).toEqual({ from: 2, to: 19, count: 18, legacy: false });
  });
});

describe('persistent-tally: no duplicate hover badge', () => {
  test('marked tally yields no stable tokens', () => {
    expect(stableTokensWithoutMarked('正正正·3<!--zt:18-->', 0)).toEqual([]);
    expect(stableTokensWithoutMarked('a 正正<!--zt:10--> b', 0)).toEqual([]);
  });

  test('legacy tally keeps heuristic badge', () => {
    expect(stableTokensWithoutMarked('foo 正正正·3 bar', 0)).toEqual([
      { from: 4, to: 9, count: 18 },
    ]);
    expect(parseStableTokens('foo 正正 bar', 0)).toEqual([{ from: 4, to: 6, count: 10 }]);
  });
});

describe('persistent-tally: decoration field and mapping', () => {
  const fieldFor = (doc: string) => {
    const field = createPersistentTallyField(() => {});
    const state = EditorState.create({ doc, extensions: [field] });
    return { field, state };
  };
  const rangesOf = (state: EditorState, field: ReturnType<typeof createPersistentTallyField>) => {
    const out: Array<[number, number]> = [];
    state.field(field).between(0, state.doc.length, (from, to) => {
      out.push([from, to]);
    });
    return out;
  };

  test('verified token decorates, mismatch does not', () => {
    const good = fieldFor('AA 正正正·3<!--zt:18--> BB');
    expect(rangesOf(good.state, good.field)).toEqual([[3, 20]]);
    const bad = fieldFor('AA 正正<!--zt:7--> BB');
    expect(rangesOf(bad.state, bad.field)).toEqual([]);
    const plain = fieldFor('<!-- note --> just prose');
    expect(rangesOf(plain.state, plain.field)).toEqual([]);
  });

  test('edits before the token shift it', () => {
    const { field, state } = fieldFor('AA 正正<!--zt:10--> BB');
    const tr = state.update({ changes: { from: 0, insert: 'XX' } });
    expect(rangesOf(tr.state, field)).toEqual([[5, 19]]);
  });

  test('edits after the token leave it alone', () => {
    const { field, state } = fieldFor('AA 正正<!--zt:10-->');
    const tr = state.update({ changes: { from: state.doc.length, insert: ' tail' } });
    expect(rangesOf(tr.state, field)).toEqual([[3, 17]]);
  });

  test('edits inside the token fail closed', () => {
    const { field, state } = fieldFor('AA 正正<!--zt:10--> BB');
    const tr = state.update({ changes: { from: 4, insert: 'Q' } });
    expect(rangesOf(tr.state, field)).toEqual([]);
  });

  test('suppress range is skipped, release restores', () => {
    const { state } = fieldFor('AA 正正<!--zt:10--> BB');
    expect(collectPersistedTokens(state, null)).toHaveLength(1);
    expect(collectPersistedTokens(state, { from: 3, to: 17 })).toEqual([]);
    expect(collectPersistedTokens(state, { from: 100, to: 110 })).toHaveLength(1);
  });
});

describe('persistent-tally: resume session', () => {
  const CURSOR = { line: 0, ch: 4 };
  let view: EditorView;
  let replaceRange: jest.Mock;
  let editor: Editor;

  const makeBundle = (doc: string) => {
    document.body.innerHTML = '';
    const parent = document.createElement('div');
    parent.style.fontFamily = 'SimSun, serif';
    parent.style.fontSize = '24px';
    parent.style.color = 'rgb(0, 0, 0)';
    document.body.appendChild(parent);
    view = new EditorView({
      doc,
      extensions: [tallyExtension, createPersistentTallyExtension(() => {})],
      parent,
    });
    const dom = view.dom as HTMLElement;
    dom.style.fontFamily = 'SimSun, serif';
    dom.style.fontSize = '24px';
    dom.style.color = 'rgb(0, 0, 0)';
    try {
      (view as unknown as { coordsAtPos: unknown }).coordsAtPos = () => ({
        left: 100,
        top: 100,
        bottom: 120,
      });
    } catch {
      // Host will fail-closed without the stub.
    }
    replaceRange = jest.fn((text: string, from: EditorPosition, to?: EditorPosition) => {
      const l1 = view.state.doc.line(from.line + 1);
      const a = l1.from + from.ch;
      if (to) {
        const l2 = view.state.doc.line(to.line + 1);
        view.dispatch({ changes: { from: a, to: l2.from + to.ch, insert: text } });
      } else {
        view.dispatch({ changes: { from: a, insert: text } });
      }
    });
    editor = {
      getCursor: () => ({ ...CURSOR }),
      getValue: () => view.state.doc.toString(),
      posToOffset: (pos: EditorPosition) => view.state.doc.line(pos.line + 1).from + pos.ch,
      offsetToPos: (off: number) => {
        const line = view.state.doc.lineAt(off);
        return { line: line.number - 1, ch: off - line.from };
      },
      replaceRange,
      cm: view,
    } as unknown as Editor;
  };

  const mockLeaf = () =>
    ({
      on: jest.fn(() => ({ off: () => {} }) as EventRef),
    }) as unknown as WorkspaceLeaf;
  const mockWorkspace = (leaf: WorkspaceLeaf) =>
    ({
      activeLeaf: leaf,
      on: jest.fn(() => ({ off: () => {} }) as EventRef),
      getActiveViewOfType: jest.fn(),
    }) as unknown as Workspace;

  const startResume = (from: number, to: number, count: number) => {
    const leaf = mockLeaf();
    const session = createEditorSession({
      editor,
      view: { editor } as unknown as MarkdownView,
      leaf,
      workspace: mockWorkspace(leaf),
      settings: { commitFormat: 'stable' },
      onSessionEnd: () => {},
      resume: { from, to, count, legacy: false },
    });
    return session;
  };

  afterEach(() => {
    try {
      view.destroy();
    } catch {
      // Ignore teardown races.
    }
    document.body.innerHTML = '';
  });

  test('resume 18 starts at 18 with persistent chip suppressed', () => {
    makeBundle('AAA 正正正·3<!--zt:18--> BBB\n');
    const session = startResume(4, 21, 18);
    expect(session.start()).toBe(true);
    const active = document.querySelector('.zheng-tally-inline[data-mode="active"]');
    expect(active?.querySelector('.zt-total')?.textContent).toBe('18');
    expect(document.querySelector('[data-persistent]')).toBeNull();
    session.destroy();
  });

  test('resume 18 + goes to 19', () => {
    makeBundle('AAA 正正正·3<!--zt:18--> BBB\n');
    const session = startResume(4, 21, 18);
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
    expect(document.querySelector('[data-mode="active"] .zt-total')?.textContent).toBe('19');
    session.destroy();
  });

  test('resume 18 - goes to 17', () => {
    makeBundle('AAA 正正正·3<!--zt:18--> BBB\n');
    const session = startResume(4, 21, 18);
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
    expect(document.querySelector('[data-mode="active"] .zt-total')?.textContent).toBe('17');
    session.destroy();
  });

  test('resume + Enter is a single document edit with marker', () => {
    makeBundle('AAA 正正正·3<!--zt:18--> BBB\n');
    const session = startResume(4, 21, 18);
    session.start();
    for (let i = 0; i < 5; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(replaceRange).toHaveBeenCalledTimes(1);
    expect(replaceRange).toHaveBeenCalledWith(
      '正正正正·3<!--zt:23-->',
      expect.objectContaining({ line: 0, ch: 4 }),
      expect.objectContaining({ line: 0, ch: 21 }),
    );
    expect(view.state.doc.toString()).toBe('AAA 正正正正·3<!--zt:23--> BBB\n');
    // Persistent chip returns for the new count.
    const chip = document.querySelector('[data-persistent]');
    expect(chip?.getAttribute('data-count')).toBe('23');
    session.destroy();
  });

  test('resume + Esc leaves raw Markdown byte-identical', () => {
    makeBundle('AAA 正正正·3<!--zt:18--> BBB\n');
    const before = view.state.doc.toString();
    const session = startResume(4, 20, 18);
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(replaceRange).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe(before);
    // Original persistent chip is restored.
    expect(document.querySelector('[data-persistent]')?.getAttribute('data-count')).toBe('18');
    session.destroy();
  });

  test('resume to zero + Enter deletes token and marker', () => {
    makeBundle('x ·1<!--zt:1--> y\n');
    const session = startResume(2, 15, 1);
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(replaceRange).toHaveBeenCalledTimes(1);
    expect(replaceRange).toHaveBeenCalledWith('', expect.anything(), expect.anything());
    expect(view.state.doc.toString()).toBe('x  y\n');
    expect(document.querySelector('[data-persistent]')).toBeNull();
    session.destroy();
  });
});
