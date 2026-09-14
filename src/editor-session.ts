import type { Editor, MarkdownView, WorkspaceLeaf, Workspace, EditorPosition } from 'obsidian';
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

function isSystemKey(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.altKey || e.metaKey || e.shiftKey;
}

function isPrintableKey(e: KeyboardEvent): boolean {
  return e.key.length === 1 && !isSystemKey(e);
}

function isTallyControlKey(e: KeyboardEvent): boolean {
  return e.key === ' ' || e.key === 'Spacebar' || e.key === 'Backspace' || e.key === 'Enter' || e.key === 'Escape';
}

interface OffableEventRef {
  off(): void;
}

interface LifecycleHandle {
  registerEvent(eventRef: OffableEventRef): void;
  registerDomEvent(el: EventTarget, type: string, handler: EventListener, options?: boolean | AddEventListenerOptions): void;
  unload(): void;
}

function createLifecycleManager(): LifecycleHandle {
  const registeredEvents: OffableEventRef[] = [];
  const registeredDomEvents: Array<{ el: EventTarget; type: string; handler: EventListener; options?: boolean | AddEventListenerOptions }> = [];

  return {
    registerEvent(eventRef: OffableEventRef): void {
      registeredEvents.push(eventRef);
    },
    registerDomEvent(el: EventTarget, type: string, handler: EventListener, options?: boolean | AddEventListenerOptions): void {
      el.addEventListener(type, handler, options);
      registeredDomEvents.push({ el, type, handler, options });
    },
    unload(): void {
      for (const eventRef of registeredEvents) {
        eventRef.off();
      }
      registeredEvents.length = 0;

      for (const { el, type, handler, options } of registeredDomEvents) {
        el.removeEventListener(type, handler, options);
      }
      registeredDomEvents.length = 0;
    },
  };
}

export function createEditorSession(deps: SessionDependencies): EditorSession {
  const { editor, view, leaf, workspace, settings, onSessionEnd } = deps;
  let state: TallyState | null = null;
  let renderer: TallyRenderer | null = null;
  let overlayContainer: HTMLElement | null = null;
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let isActive = false;
  let cursorPos: { left: number; top: number; bottom: number } | null = null;
  let capturedCursor: EditorPosition | null = null;

  const lifecycle = createLifecycleManager();

  function cleanup(): void {
    if (isActive) {
      isActive = false;
    }

    if (keydownHandler) {
      window.removeEventListener('keydown', keydownHandler, true);
      keydownHandler = null;
    }

    lifecycle.unload();

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
    capturedCursor = null;
    onSessionEnd();
  }

  function commitAndClose(): void {
    if (!state || !isActive || !capturedCursor) {
      cleanup();
      return;
    }
    const text = settings.commitFormat === 'unicode' ? state.toUnicodeText() : state.toStableText();
    if (text) {
      editor.replaceRange(text, capturedCursor);
    }
    cleanup();
  }

  function cancelAndClose(): void {
    cleanup();
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (!isActive || !state) return;

    if (isTallyControlKey(e)) {
      e.preventDefault();
      e.stopPropagation();

      switch (e.key) {
        case ' ':
        case 'Spacebar':
          state.increment();
          renderer?.update(state.count);
          break;
        case 'Backspace':
          state.decrement();
          renderer?.update(state.count);
          break;
        case 'Enter':
          commitAndClose();
          break;
        case 'Escape':
          cancelAndClose();
          break;
      }
      return;
    }

    if (isPrintableKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
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
      try {
        renderer.mount(overlayContainer);
      } catch (e) {
        cleanup();
        return false;
      }

      cursorPos = getCursorScreenPosition(editor);
      capturedCursor = editor.getCursor();

      const overlay = overlayContainer.querySelector('.zheng-tally-overlay') as HTMLElement;
      if (overlay) {
        const rect = overlay.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        let top = cursorPos.bottom + 4;
        if (top + rect.height > viewportHeight - 8) {
          top = cursorPos.top - rect.height - 4;
        }
        overlay.style.left = `${cursorPos.left}px`;
        overlay.style.top = `${top}px`;
      }

      renderer.onClick(() => {
        if (state) {
          state.increment();
          renderer?.update(state.count);
        }
      });

      keydownHandler = handleKeydown;
      lifecycle.registerDomEvent(window, 'keydown', keydownHandler as EventListener, true);

      const leafChangeEventRef = workspace.on('active-leaf-change', handleLeafChange) as OffableEventRef;
      lifecycle.registerEvent(leafChangeEventRef);

      isActive = true;
      return true;
    },
    destroy(): void {
      cleanup();
    },
  };
}