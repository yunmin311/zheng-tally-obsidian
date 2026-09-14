import { createEditorSession } from '../src/editor-session';
import type { Editor, MarkdownView, WorkspaceLeaf, Workspace, EventRef } from 'obsidian';

const createMockEditor = () => {
  const cursor = { line: 0, ch: 0 };
  return {
    cm: {
      coordsAtPos: () => ({ left: 100, top: 100, bottom: 120 }),
      wrapperElement: document.body,
    },
    getCursor: () => cursor,
    replaceRange: jest.fn(),
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

describe('EditorSession integration', () => {
  let mockEditor: Editor;
  let mockView: MarkdownView;
  let mockLeaf: WorkspaceLeaf;
  let mockWorkspace: Workspace;
  let settings: { commitFormat: 'stable' | 'unicode' };

  beforeEach(() => {
    mockEditor = createMockEditor();
    mockView = createMockView(mockEditor);
    mockLeaf = createMockLeaf();
    mockWorkspace = createMockWorkspace(mockLeaf);
    settings = { commitFormat: 'stable' };
  });

  test('session start creates overlay and state', () => {
    let sessionEnded = false;
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => { sessionEnded = true; },
    });

    const started = session.start();
    expect(started).toBe(true);
    expect(sessionEnded).toBe(false);

    const overlay = document.querySelector('.zheng-tally-overlay');
    expect(overlay).not.toBeNull();

    session.destroy();
  });

  test('Space increments count and updates renderer', () => {
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

    const tallyText = document.querySelector('.zheng-tally-overlay span');
    expect(tallyText?.textContent).toContain('一');

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

    const tallyContainer = document.querySelector('.zheng-tally-overlay span');
    expect(tallyContainer?.textContent).toContain('一');

    session.destroy();
  });

  test('Enter commits text and closes session', () => {
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
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    }

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(mockEditor.replaceRange).toHaveBeenCalledWith('正', mockEditor.getCursor());
    expect(sessionEnded).toBe(true);
    expect(document.querySelector('.zheng-tally-overlay')).toBeNull();
  });

  test('Esc cancels without inserting text', () => {
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
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(mockEditor.replaceRange).not.toHaveBeenCalled();
    expect(document.querySelector('.zheng-tally-overlay')).toBeNull();
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
    (mockWorkspace as any).activeLeaf = null;

    const leafChangeHandler = (mockWorkspace.on as jest.Mock).mock.calls.find(
      (c: any[]) => c[0] === 'active-leaf-change'
    )?.[1];

    if (leafChangeHandler) {
      leafChangeHandler();
    }

    expect(sessionEnded).toBe(true);
    expect(document.querySelector('.zheng-tally-overlay')).toBeNull();
  });

  test('Plugin unload destroys session', () => {
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

    expect(document.querySelector('.zheng-tally-overlay')).toBeNull();
  });

  test('Count 18 renders three 正 and three-stroke partial', () => {
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });

    session.start();

    for (let i = 0; i < 18; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    }

    const tallyContainer = document.querySelector('.zheng-tally-overlay span') as HTMLElement;
    const text = tallyContainer?.textContent || '';
    expect(text).toContain('正正正');
    expect(text).toContain('下');

    session.destroy();
  });

  test('Unicode commit format works', () => {
    const unicodeSettings = { commitFormat: 'unicode' as const };
    let sessionEnded = false;
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings: unicodeSettings,
      onSessionEnd: () => { sessionEnded = true; },
    });

    session.start();
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    }

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(mockEditor.replaceRange).toHaveBeenCalledWith('𝍥', mockEditor.getCursor());
    expect(sessionEnded).toBe(true);
  });
});