import { createEditorSession } from '../src/editor-session';
import type { Editor, MarkdownView, WorkspaceLeaf, Workspace, EventRef, EditorPosition } from 'obsidian';

const createMockEditor = (overrides: Partial<{
  cursor: EditorPosition;
  offset: number;
  coords: { left: number; top: number; bottom: number };
  replaceRange: jest.Mock;
  dom: HTMLElement;
}> = {}) => {
  const cursor = overrides.cursor ?? { line: 0, ch: 0 };
  const dom = overrides.dom ?? document.createElement('div');
  if (!dom.parentNode) document.body.appendChild(dom);
  dom.style.fontFamily = 'SimSun, serif';
  dom.style.fontSize = '24px';
  dom.style.color = 'rgb(0, 0, 0)';
  return {
    cm: {
      dom,
      coordsAtPos: () => overrides.coords ?? { left: 100, top: 100, bottom: 120 },
    },
    posToOffset: () => overrides.offset ?? 0,
    getCursor: () => cursor,
    replaceRange: overrides.replaceRange ?? jest.fn(),
  } as unknown as Editor;
};

const createMockView = (editor: Editor) => ({
  editor,
} as unknown as MarkdownView);

const createMockLeaf = () => ({
  on: jest.fn((_event: string, _handler: () => void) => ({ off: () => {} } as EventRef)),
} as unknown as WorkspaceLeaf);

const createMockWorkspace = (leaf: WorkspaceLeaf) => ({
  activeLeaf: leaf,
  on: jest.fn((_event: string, _handler: () => void) => ({ off: () => {} } as EventRef)),
  getActiveViewOfType: jest.fn(),
} as unknown as Workspace);

describe('EditorSession integration (inline CM6 widget)', () => {
  let mockEditor: Editor;
  let mockView: MarkdownView;
  let mockLeaf: WorkspaceLeaf;
  let mockWorkspace: Workspace;
  let settings: { commitFormat: 'stable' | 'unicode' };

  beforeEach(() => {
    document.body.innerHTML = '';
    mockEditor = createMockEditor();
    mockView = createMockView(mockEditor);
    mockLeaf = createMockLeaf();
    mockWorkspace = createMockWorkspace(mockLeaf);
    settings = { commitFormat: 'stable' };
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('session start creates inline widget inside editor dom', () => {
    let sessionEnded = false;
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => { sessionEnded = true; },
    });

    expect(session.start()).toBe(true);
    expect(sessionEnded).toBe(false);
    expect(document.querySelector('.zheng-tally-inline')).not.toBeNull();
    // Normal path is inline, not fixed overlay.
    expect(document.querySelector('.zheng-tally-overlay')).toBeNull();
    session.destroy();
  });

  test('fail-closed when CM6 host cannot resolve (no cm/dom)', () => {
    const bad = {
      getCursor: () => ({ line: 0, ch: 0 }),
      replaceRange: jest.fn(),
    } as unknown as Editor;
    const session = createEditorSession({
      editor: bad,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    expect(session.start()).toBe(false);
    expect(document.querySelector('.zheng-tally-inline')).toBeNull();
    expect(document.querySelector('.zheng-tally-overlay')).toBeNull();
    session.destroy();
  });

  test('Space increments count and updates inline widget', () => {
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    const widget = document.querySelector('.zheng-tally-inline');
    expect(widget).not.toBeNull();
    expect(widget?.textContent).not.toContain('一');
    const hasCanvas = widget?.querySelector('canvas') !== null;
    const hasFallback = (widget?.textContent || '').includes('[1]');
    expect(hasCanvas || hasFallback).toBe(true);
    session.destroy();
  });

  test('+ and NumpadAdd increment', () => {
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
    let widget = document.querySelector('.zheng-tally-inline');
    expect(widget?.textContent).toContain('1');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Add', code: 'NumpadAdd' }));
    widget = document.querySelector('.zheng-tally-inline');
    expect(widget?.textContent).toContain('2');
    session.destroy();
  });

  test('Shift+= is recognized as plus (shift must not passthrough)', () => {
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', shiftKey: true, code: 'Equal' }));
    expect(document.querySelector('.zheng-tally-inline')?.textContent).toContain('1');
    session.destroy();
  });

  test('- and NumpadSubtract decrement, floor at 0', () => {
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
    expect(document.querySelector('.zheng-tally-inline')?.textContent).toContain('0');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', code: 'NumpadSubtract' }));
    expect(document.querySelector('.zheng-tally-inline')?.textContent).toContain('0');
    session.destroy();
  });

  test('Backspace decrements count', () => {
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(document.querySelector('.zheng-tally-inline')?.textContent).toContain('1');
    session.destroy();
  });

  test('Enter commits text and removes widget with single replaceRange', () => {
    const replaceSpy = jest.fn();
    mockEditor = createMockEditor({ replaceRange: replaceSpy });
    mockView = createMockView(mockEditor);
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    session.start();
    for (let i = 0; i < 5; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(replaceSpy).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith('正', mockEditor.getCursor());
    expect(document.querySelector('.zheng-tally-inline')).toBeNull();
    session.destroy();
  });

  test('Esc cancels without inserting text', () => {
    const replaceSpy = jest.fn();
    mockEditor = createMockEditor({ replaceRange: replaceSpy });
    mockView = createMockView(mockEditor);
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.zheng-tally-inline')).toBeNull();
    session.destroy();
  });

  test('Ctrl/Alt/Meta combos passthrough and keep session', () => {
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', altKey: true }));
    expect(document.querySelector('.zheng-tally-inline')).not.toBeNull();
    session.destroy();
  });

  test('Second start during active session returns false', () => {
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    expect(session.start()).toBe(true);
    expect(session.start()).toBe(false);
    session.destroy();
  });

  test('Leaf change during session cancels it', () => {
    let sessionEnded = false;
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => { sessionEnded = true; },
    });
    session.start();
    (mockWorkspace as unknown as { activeLeaf: unknown }).activeLeaf = null;
    const handler = (mockWorkspace.on as jest.Mock).mock.calls.find(
      (c: unknown[]) => c[0] === 'active-leaf-change',
    )?.[1] as (() => void) | undefined;
    if (handler) handler();
    expect(sessionEnded).toBe(true);
    expect(document.querySelector('.zheng-tally-inline')).toBeNull();
    session.destroy();
  });

  test('Count 18 renders three 正 and state 3 inline', () => {
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    session.start();
    for (let i = 0; i < 18; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    const widget = document.querySelector('.zheng-tally-inline');
    expect(widget?.querySelectorAll('[data-full="true"]').length).toBe(3);
    expect(widget?.querySelector('[data-state="3"]')).not.toBeNull();
    session.destroy();
  });

  test('Unicode commit format works with single edit', () => {
    const replaceSpy = jest.fn();
    mockEditor = createMockEditor({ replaceRange: replaceSpy });
    mockView = createMockView(mockEditor);
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings: { commitFormat: 'unicode' },
      onSessionEnd: () => {},
    });
    session.start();
    for (let i = 0; i < 5; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith('\u{1D376}', mockEditor.getCursor());
    session.destroy();
  });

  test('Input isolation: printable keys blocked, no doc edit during tally', () => {
    const replaceSpy = jest.fn();
    mockEditor = createMockEditor({ replaceRange: replaceSpy });
    mockView = createMockView(mockEditor);
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    session.start();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(document.querySelector('.zheng-tally-inline')?.textContent).not.toContain('a');
    expect(replaceSpy).not.toHaveBeenCalled();
    session.destroy();
  });

  test('Captured cursor used for commit', () => {
    const initialCursor = { line: 5, ch: 10 };
    const replaceSpy = jest.fn();
    mockEditor = createMockEditor({ cursor: initialCursor, replaceRange: replaceSpy });
    mockView = createMockView(mockEditor);
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    session.start();
    mockEditor.getCursor = () => ({ line: 10, ch: 20 });
    for (let i = 0; i < 5; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(replaceSpy).toHaveBeenCalledWith('正', initialCursor);
    session.destroy();
  });

  test('Listener cleanup on destroy', () => {
    const removeSpy = jest.spyOn(window, 'removeEventListener');
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });
    session.start();
    session.destroy();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    removeSpy.mockRestore();
  });
});
