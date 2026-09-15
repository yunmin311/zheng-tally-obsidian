import type { Editor, MarkdownView, WorkspaceLeaf, Workspace, EditorPosition } from 'obsidian';
import { Component } from 'obsidian';
import { createTallyState, type TallyState } from './tally-state';
import {
  createFallbackOverlayRenderer,
  createInlineTallyRenderer,
  type InlineTallyRenderer,
} from './renderer';
import { resolveEditorHost, type ResolvedEditorHost } from './editor-host';
import type { Settings } from './settings';

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

function isSystemKey(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.altKey || e.metaKey;
}

function isPrintableKey(e: KeyboardEvent): boolean {
  return e.key.length === 1 && !isSystemKey(e);
}

function isPlusKey(e: KeyboardEvent): boolean {
  if (e.key === '+') return true;
  if (e.code === 'NumpadAdd') return true;
  if (e.code === 'Add') return true;
  if (e.key === '=' && e.shiftKey) return true;
  return false;
}

function isMinusKey(e: KeyboardEvent): boolean {
  if (e.key === '-') return true;
  if (e.key === '_') return true;
  if (e.code === 'NumpadSubtract') return true;
  if (e.code === 'Subtract') return true;
  if (e.code === 'Minus') return true;
  return false;
}

function isTallyControlKey(e: KeyboardEvent): boolean {
  if (e.key === ' ' || e.key === 'Spacebar') return true;
  if (e.key === 'Backspace') return true;
  if (e.key === 'Enter') return true;
  if (e.key === 'Escape') return true;
  if (isPlusKey(e)) return true;
  if (isMinusKey(e)) return true;
  if (e.code === 'NumpadAdd' || e.code === 'NumpadSubtract') return true;
  return false;
}

export function createEditorSession(deps: SessionDependencies): EditorSession {
  const { editor, view, leaf, workspace, settings, onSessionEnd } = deps;
  let state: TallyState | null = null;
  let renderer: InlineTallyRenderer | null = null;
  let rendererHost: HTMLElement | null = null;
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let isActive = false;
  let capturedCursor: EditorPosition | null = null;
  let host: ResolvedEditorHost | null = null;

  const component = new (class extends Component {
    // Do not call cleanup() here to avoid circular dependency
    // cleanup() will call component.unload() to clean up registered events
  })();
  component.load();

  function cleanup(): void {
    if (isActive) {
      isActive = false;
    }

    if (keydownHandler) {
      window.removeEventListener('keydown', keydownHandler, true);
      keydownHandler = null;
    }

    component.unload();

    if (renderer) {
      try {
        renderer.destroy();
      } catch {
        // Ignore teardown races.
      }
      renderer = null;
    }
    rendererHost = null;
    state = null;
    capturedCursor = null;
    host = null;
    onSessionEnd();
  }

  function commitAndClose(): void {
    if (!state || !isActive || !capturedCursor) {
      cleanup();
      return;
    }
    const text = settings.commitFormat === 'unicode' ? state.toUnicodeText() : state.toStableText();
    if (text) {
      try {
        editor.replaceRange(text, capturedCursor);
      } catch {
        // Commit failure still tears down without leaking widget/listeners.
      }
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

      if (e.key === ' ' || e.key === 'Spacebar' || isPlusKey(e)) {
        state.increment();
        try {
          renderer?.update(state.count);
        } catch {
          // Render failure never breaks counting session.
        }
      } else if (e.key === 'Backspace' || isMinusKey(e)) {
        state.decrement();
        try {
          renderer?.update(state.count);
        } catch {
          // Render failure never breaks counting session.
        }
      } else if (e.key === 'Enter') {
        commitAndClose();
      } else if (e.key === 'Escape') {
        cancelAndClose();
      }
      return;
    }

    if (isSystemKey(e)) return;

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

      const resolved = resolveEditorHost(editor);
      if (!resolved) return false;
      host = resolved;

      state = createTallyState(0);

      let inline: InlineTallyRenderer | null = null;
      try {
        inline = createInlineTallyRenderer(host);
      } catch {
        inline = null;
      }
      if (!inline) {
        state = null;
        host = null;
        return false;
      }

      try {
        host.dom.appendChild(inline.element);
      } catch {
        try {
          inline.destroy();
        } catch {
          // Ignore teardown races.
        }
        let fallback: InlineTallyRenderer | null = null;
        try {
          fallback = createFallbackOverlayRenderer(host.typography);
          document.body.appendChild(fallback.element);
        } catch {
          fallback = null;
        }
        if (!fallback) {
          state = null;
          host = null;
          return false;
        }
        inline = fallback;
        rendererHost = document.body;
      }
      if (!rendererHost) rendererHost = host.dom;
      renderer = inline;

      try {
        renderer.update(0);
      } catch {
        cleanup();
        return false;
      }

      try {
        capturedCursor = editor.getCursor();
      } catch {
        cleanup();
        return false;
      }
      if (!capturedCursor) {
        cleanup();
        return false;
      }

      renderer.onClick(() => {
        if (state) {
          state.increment();
          try {
            renderer?.update(state.count);
          } catch {
            // Ignore render failures on click.
          }
        }
      });

      try {
        keydownHandler = handleKeydown;
        component.registerDomEvent(window, 'keydown', keydownHandler, true);

        const leafChangeEventRef = workspace.on('active-leaf-change', handleLeafChange);
        component.registerEvent(leafChangeEventRef);
      } catch {
        cleanup();
        return false;
      }

      isActive = true;
      return true;
    },
    destroy(): void {
      cleanup();
    },
  };
}

export { isTallyControlKey, isPlusKey, isMinusKey };
