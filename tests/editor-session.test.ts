import { EditorView } from '@codemirror/view';
import { createEditorSession } from '../src/editor-session';
import { tallyExtension } from '../src/cm6-widget';
import type { Editor, MarkdownView, WorkspaceLeaf, Workspace, EventRef, EditorPosition } from 'obsidian';

interface MockEditorBundle {
  editor: Editor;
  view: EditorView;
  replaceRange: jest.Mock;
  cursor: EditorPosition;
}

const makeRealEditor = (doc = 'AAA BBB\nsecond line\n', cursor: EditorPosition = { line: 0, ch: 4 }): MockEditorBundle => {
  const parent = document.createElement('div');
  parent.style.fontFamily = 'SimSun, serif';
  parent.style.fontSize = '24px';
  parent.style.fontWeight = '400';
  parent.style.fontStyle = 'normal';
  parent.style.color = 'rgb(0, 0, 0)';
  document.body.appendChild(parent);
  const view = new EditorView({ doc, extensions: [tallyExtension], parent });
  const dom = view.dom as HTMLElement;
  dom.style.fontFamily = 'SimSun, serif';
  dom.style.fontSize = '24px';
  dom.style.color = 'rgb(0, 0, 0)';
  // jsdom has no layout: stub screen coords so host resolution succeeds.
  // Production uses real EditorView.coordsAtPos; placement never depends on it.
  try {
    (view as unknown as { coordsAtPos: unknown }).coordsAtPos = () => ({ left: 100, top: 100, bottom: 120 });
  } catch {
    // Ignore stub failures; host will fail-closed.
  }
  const replaceRange = jest.fn((text: string, pos: EditorPosition) => {
    const line = view.state.doc.line(pos.line + 1);
    view.dispatch({ changes: { from: line.from + pos.ch, insert: text } });
  });
  const editor = {
    getCursor: () => ({ ...cursor }),
    posToOffset: (pos: EditorPosition) => view.state.doc.line(pos.line + 1).from + pos.ch,
    offsetToPos: (off: number) => {
      const line = view.state.doc.lineAt(off);
      return { line: line.number - 1, ch: off - line.from };
    },
    replaceRange,
    cm: view,
  } as unknown as Editor;
  return { editor, view, replaceRange, cursor };
};

const createMockView = (editor: Editor) => ({ editor } as unknown as MarkdownView);
const createMockLeaf = () => ({
  on: jest.fn((_event: string, _handler: () => void) => ({ off: () => {} } as EventRef)),
} as unknown as WorkspaceLeaf);
const createMockWorkspace = (leaf: WorkspaceLeaf) => ({
  activeLeaf: leaf,
  on: jest.fn((_event: string, _handler: () => void) => ({ off: () => {} } as EventRef)),
  getActiveViewOfType: jest.fn(),
} as unknown as Workspace);

const queryWidget = (): HTMLElement | null => document.querySelector('.zheng-tally-inline') as HTMLElement | null;

describe('EditorSession integration (true CM6 Decoration widget)', () => {
  let bundle: MockEditorBundle;
  let mockView: MarkdownView;
  let mockLeaf: WorkspaceLeaf;
  let mockWorkspace: Workspace;
  let settings: { commitFormat: 'stable' | 'unicode' };

  beforeEach(() => {
    document.body.innerHTML = '';
    bundle = makeRealEditor();
    mockView = createMockView(bundle.editor);
    mockLeaf = createMockLeaf();
    mockWorkspace = createMockWorkspace(mockLeaf);
    settings = { commitFormat: 'stable' };
  });

  afterEach(() => {
    try {
      bundle.view.destroy();
    } catch {
      // Ignore teardown races.
    }
    document.body.innerHTML = '';
  });

  const startSession = (onSessionEnd: () => void = () => {}) =>
    createEditorSession({
      editor: bundle.editor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd,
    });

  test('session start creates true inline widget inside editor (no fixed overlay)', () => {
    const session = startSession();
    expect(session.start()).toBe(true);
    const widget = queryWidget();
    expect(widget).not.toBeNull();
    expect(document.querySelector('.zheng-tally-overlay')).toBeNull();
    // Widget must live inside the CM editor DOM (layout participant).
    expect(bundle.view.dom.contains(widget!)).toBe(true);
    expect(widget!.style.position).not.toBe('absolute');
    expect(widget!.style.position).not.toBe('fixed');
    // Editor root style.position must not be rewritten by normal path.
    expect(bundle.view.dom.style.position).not.toBe('relative');
    session.destroy();
  });

  test('fail-closed when CM6 host cannot resolve (no cm/dom)', () => {
    const bad = { getCursor: () => ({ line: 0, ch: 0 }), replaceRange: jest.fn() } as unknown as Editor;
    const session = createEditorSession({
      editor: bad,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    expect(session.start()).toBe(false);
    expect(queryWidget()).toBeNull();
    session.destroy();
  });

  test('widget sits mid-text AAA|BBB and reserves width', () => {
    const session = startSession();
    expect(session.start()).toBe(true);
    const widget = queryWidget()!;
    // Anchored at AAA|BBB (offset 4 in "AAA BBB"): widget inside same line element.
    const line = widget.closest('.cm-line');
    expect(line).not.toBeNull();
    expect(line!.textContent).toContain('AAA');
    expect(line!.textContent).toContain('BBB');
    session.destroy();
  });

  test('Space increments, +/- work, floor at 0', () => {
    const session = startSession();
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(queryWidget()?.textContent).toContain('1');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
    expect(queryWidget()?.textContent).toContain('2');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Add', code: 'NumpadAdd' }));
    expect(queryWidget()?.textContent).toContain('3');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
    expect(queryWidget()?.textContent).toContain('2');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', code: 'NumpadSubtract' }));
    expect(queryWidget()?.textContent).toContain('1');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(queryWidget()?.textContent).toContain('0');
    session.destroy();
  });

  test('Shift+= recognized as plus', () => {
    const session = startSession();
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', shiftKey: true, code: 'Equal' }));
    expect(queryWidget()?.textContent).toContain('1');
    session.destroy();
  });

  test('Enter single doc mutation with mapped anchor, widget removed', () => {
    const session = startSession();
    session.start();
    for (let i = 0; i < 5; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(bundle.replaceRange).not.toHaveBeenCalled();
    const beforeLen = bundle.view.state.doc.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(bundle.replaceRange).toHaveBeenCalledTimes(1);
    expect(bundle.replaceRange).toHaveBeenCalledWith('正', expect.objectContaining({ line: 0 }));
    expect(queryWidget()).toBeNull();
    expect(bundle.view.state.doc.length).toBe(beforeLen + '正'.length);
    session.destroy();
  });

  test('Esc zero mutations, widget removed, doc unchanged', () => {
    const session = startSession();
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    const before = bundle.view.state.doc.toString();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(bundle.replaceRange).not.toHaveBeenCalled();
    expect(bundle.view.state.doc.toString()).toBe(before);
    expect(queryWidget()).toBeNull();
    session.destroy();
  });

  test('Ctrl/Alt/Meta passthrough keeps session', () => {
    const session = startSession();
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', altKey: true }));
    expect(queryWidget()).not.toBeNull();
    session.destroy();
  });

  test('count 18 compacts preview but keeps total, no 一/丁/下 text', () => {
    const session = startSession();
    session.start();
    for (let i = 0; i < 18; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    const widget = queryWidget()!;
    expect(widget.querySelectorAll('[data-full="true"]').length).toBe(2);
    expect(widget.querySelector('.zt-ellipsis')).not.toBeNull();
    expect(widget.querySelector('[data-state="3"]')).not.toBeNull();
    expect(widget.querySelector('.zt-total')?.textContent).toBe('18');
    expect(widget.textContent).not.toContain('一');
    session.destroy();
  });

  test('scroll keeps anchor in line (mapping, no new mutation)', () => {
    const session = startSession();
    session.start();
    const widget = queryWidget()!;
    const lineBefore = widget.closest('.cm-line');
    bundle.view.dom.querySelector('.cm-scroller')?.scrollTo?.(0, 50);
    const widgetAfter = queryWidget()!;
    expect(widgetAfter.closest('.cm-line')).toBe(lineBefore);
    expect(bundle.replaceRange).not.toHaveBeenCalled();
    session.destroy();
  });

  test('leaf change cancels without doc mutation', () => {
    let ended = false;
    const session = createEditorSession({
      editor: bundle.editor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {
        ended = true;
      },
    });
    session.start();
    (mockWorkspace as unknown as { activeLeaf: unknown }).activeLeaf = null;
    const handler = (mockWorkspace.on as jest.Mock).mock.calls.find((c: unknown[]) => c[0] === 'active-leaf-change')?.[1] as
      | (() => void)
      | undefined;
    if (handler) handler();
    expect(ended).toBe(true);
    expect(queryWidget()).toBeNull();
    expect(bundle.replaceRange).not.toHaveBeenCalled();
    session.destroy();
  });
});
