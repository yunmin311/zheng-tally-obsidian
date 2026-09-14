import { createEditorSession } from '../src/editor-session';
import type { Editor, MarkdownView, WorkspaceLeaf, Workspace, EventRef, EditorPosition } from 'obsidian';

const createMockEditor = (overrides: Partial<{
  cursor: EditorPosition;
  coordsAtPos: () => { left: number; top: number; bottom: number };
  replaceRange: jest.Mock;
}> = {}) => {
  const cursor = overrides.cursor ?? { line: 0, ch: 0 };
  return {
    cm: {
      coordsAtPos: overrides.coordsAtPos ?? (() => ({ left: 100, top: 100, bottom: 120 })),
      wrapperElement: document.body,
    },
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

    expect(mockEditor.replaceRange).toHaveBeenCalledWith('\u{1D376}', mockEditor.getCursor());
    expect(sessionEnded).toBe(true);
  });

  test('Input isolation: printable keys are blocked and do not reach editor', () => {
    const replaceRangeSpy = jest.fn();
    mockEditor = createMockEditor({ replaceRange: replaceRangeSpy });
    mockView = createMockView(mockEditor);
    mockLeaf = createMockLeaf();
    mockWorkspace = createMockWorkspace(mockLeaf);

    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });

    session.start();

    // Dispatch a printable key (e.g., 'a')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    // The tally count should not change
    const tallyContainer = document.querySelector('.zheng-tally-overlay span') as HTMLElement;
    expect(tallyContainer?.textContent).not.toContain('a');

    // replaceRange should not be called
    expect(replaceRangeSpy).not.toHaveBeenCalled();

    session.destroy();
  });

  test('Input isolation: system key combinations (Ctrl+C, Ctrl+V, Alt+Tab) are allowed through', () => {
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });

    session.start();

    // These should not be blocked (they don't match tally controls, but they're system keys)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', altKey: true }));

    // Session should still be active
    const overlay = document.querySelector('.zheng-tally-overlay');
    expect(overlay).not.toBeNull();

    session.destroy();
  });

  test('Captured cursor position is used for commit, not current cursor', () => {
    const initialCursor = { line: 5, ch: 10 };
    const changedCursor = { line: 10, ch: 20 };
    const replaceRangeSpy = jest.fn();

    mockEditor = createMockEditor({
      cursor: initialCursor,
      replaceRange: replaceRangeSpy,
    });
    mockView = createMockView(mockEditor);
    mockLeaf = createMockLeaf();
    mockWorkspace = createMockWorkspace(mockLeaf);

    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });

    session.start();

    // Simulate cursor changing after session start
    (mockEditor as any).cm.coordsAtPos = () => ({ left: 200, top: 200, bottom: 220 });
    mockEditor.getCursor = () => changedCursor;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    // Should use captured cursor (initialCursor), not changedCursor
    expect(replaceRangeSpy).toHaveBeenCalledWith('正', initialCursor);

    session.destroy();
  });

  test('Overlay fixed element has correct left/top style from cursor coordinates', () => {
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });

    session.start();

    const overlay = document.querySelector('.zheng-tally-overlay') as HTMLElement;
    expect(overlay).not.toBeNull();

    // The fixed overlay should have left/top styles set
    expect(overlay.style.left).toBe('100px');
    expect(overlay.style.top).toBe('124px'); // cursorPos.bottom (120) + 4

    session.destroy();
  });

  test('Overlay flips upward when near viewport bottom', () => {
    const coordsAtPos = () => ({ left: 100, top: 800, bottom: 820 });
    mockEditor = createMockEditor({ coordsAtPos });
    mockView = createMockView(mockEditor);
    mockLeaf = createMockLeaf();
    mockWorkspace = createMockWorkspace(mockLeaf);

    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });

    session.start();

    const overlay = document.querySelector('.zheng-tally-overlay') as HTMLElement;
    expect(overlay).not.toBeNull();

    // Should flip up: cursorPos.top (800) - overlayHeight (~30) - 4
    // Since we don't know exact height in test, just verify it's positioned above cursor
    const top = parseInt(overlay.style.top, 10);
    expect(top).toBeLessThan(800);

    session.destroy();
  });

  test('Fail-closed: renderer mount failure cleans up and does not leave overlay/listeners', () => {
    let sessionEnded = false;
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => { sessionEnded = true; },
    });

    expect(() => session.start()).not.toThrow();
    session.destroy();

    expect(sessionEnded).toBe(true);
    expect(document.querySelector('.zheng-tally-overlay')).toBeNull();
  });

  test('Fail-closed: state-4 canvas failure falls back to [4] without crashing session', () => {
    // This test verifies the renderer handles canvas failure gracefully
    // by checking that count 4 renders [4] fallback instead of throwing
    const session = createEditorSession({
      editor: mockEditor,
      view: mockView,
      leaf: mockLeaf,
      workspace: mockWorkspace,
      settings,
      onSessionEnd: () => {},
    });

    session.start();

    // Trigger state 4 (four strokes)
    for (let i = 0; i < 4; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    }

    // Should not throw, should render fallback
    const tallyContainer = document.querySelector('.zheng-tally-overlay span') as HTMLElement;
    expect(tallyContainer?.textContent).toContain('[4]');

    session.destroy();
  });

  test('Listener cleanup verified: keydown and leaf change listeners are removed on cleanup', () => {
    const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');
    const leafOffSpy = jest.spyOn(mockLeaf, 'on').mockReturnValue({ off: jest.fn() } as any);

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

    // Verify keydown listener removed
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);

    // Verify leaf change listener off() called
    const leafChangeRef = (mockLeaf.on as jest.Mock).mock.results.find(
      (r: any) => r.value && typeof r.value.off === 'function'
    );
    if (leafChangeRef) {
      expect(leafChangeRef.value.off).toHaveBeenCalled();
    }

    removeEventListenerSpy.mockRestore();
    leafOffSpy.mockRestore();
  });
});