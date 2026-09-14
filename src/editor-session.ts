import type { Editor, MarkdownView, WorkspaceLeaf, Workspace, EventRef } from 'obsidian';
import { createTallyState, type TallyState } from './tally-state';
import { createTallyRenderer, type TallyRenderer } from './renderer';
import type { Settings } from './settings';

interface CodeMirrorEditor {
  coordsAtPos(pos: { line: number; ch: number }): { left: number; top: number; bottom: number };
  wrapperElement: HTMLElement;
}

interface EditorWithCM extends Editor {
  cm: CodeMirrorEditor;
}

export interface EditorSession {
  start(): boolean;
  destroy(): void;
}

interface SessionDependencies {
  editor: Editor;
  view: MarkdownView;
  leaf: WorkspaceLeaf;
  workspace: Workspace;
  settings: Settings;
  onSessionEnd: () => void;
}

function getCursorScreenPosition(editor: Editor): { left: number; top: number; bottom: number } {
  const cm = (editor as EditorWithCM).cm;
  const coords = cm.coordsAtPos(editor.getCursor());
  return {
    left: coords.left,
    top: coords.top,
    bottom: coords.bottom,
  };
}

export function createEditorSession(deps: SessionDependencies): EditorSession {
  const { editor, view, leaf, workspace, settings, onSessionEnd } = deps;
  let state: TallyState | null = null;
  let renderer: TallyRenderer | null = null;
  let overlayContainer: HTMLElement | null = null;
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let leafChangeRef: EventRef | null = null;
  let isActive = false;
  let cursorPos: { left: number; top: number; bottom: number } | null = null;

  function commitAndClose(): void {
    if (!state || !isActive) return;
    const text = settings.commitFormat === 'unicode' ? state.toUnicodeText() : state.toStableText();
    if (text) {
      editor.replaceRange(text, editor.getCursor());
    }
    cleanup();
  }

  function cancelAndClose(): void {
    cleanup();
  }

  function cleanup(): void {
    if (!isActive) return;
    isActive = false;

    if (keydownHandler) {
      window.removeEventListener('keydown', keydownHandler, true);
      keydownHandler = null;
    }
    if (leafChangeRef) {
      (leafChangeRef as EventRef & { off?: () => void }).off?.();
      leafChangeRef = null;
    }
    if (renderer) {
      renderer.destroy();
      renderer = null;
    }
    if (overlayContainer && overlayContainer.parentNode) {
      overlayContainer.parentNode.removeChild(overlayContainer);
      overlayContainer = null;
    }
    state = null;
    cursorPos = null;
    onSessionEnd();
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (!isActive || !state) return;

    switch (e.key) {
      case ' ':
      case 'Spacebar':
        e.preventDefault();
        state.increment();
        renderer?.update(state.count);
        break;
      case 'Backspace':
        e.preventDefault();
        state.decrement();
        renderer?.update(state.count);
        break;
      case 'Enter':
        e.preventDefault();
        commitAndClose();
        break;
      case 'Escape':
        e.preventDefault();
        cancelAndClose();
        break;
      default:
        break;
    }
  }

  function handleLeafChange(): void {
    const activeLeaf = workspace.activeLeaf;
    if (activeLeaf !== leaf) {
      cancelAndClose();
    }
  }

  return {
    start(): boolean {
      if (isActive) return false;
      if (!editor || !view) return false;

      const activeLeaf = workspace.activeLeaf;
      if (activeLeaf !== leaf) return false;

      state = createTallyState(0);
      renderer = createTallyRenderer(editor);

      overlayContainer = document.createElement('div');
      document.body.appendChild(overlayContainer);
      renderer.mount(overlayContainer);

      cursorPos = getCursorScreenPosition(editor);

      const inner = overlayContainer.querySelector('.zheng-tally-overlay > div') as HTMLElement;
      if (inner) {
        const rect = inner.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        let top = cursorPos.bottom + 4;
        if (top + rect.height > viewportHeight - 8) {
          top = cursorPos.top - rect.height - 4;
        }
        overlayContainer.style.left = `${cursorPos.left}px`;
        overlayContainer.style.top = `${top}px`;
      }

      renderer.onClick(() => {
        if (state) {
          state.increment();
          renderer?.update(state.count);
        }
      });

      keydownHandler = handleKeydown;
      window.addEventListener('keydown', keydownHandler, true);

      leafChangeRef = workspace.on('active-leaf-change', handleLeafChange);

      isActive = true;
      return true;
    },
    destroy(): void {
      cleanup();
    },
  };
}