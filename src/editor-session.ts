import type { Editor, MarkdownView, WorkspaceLeaf, Workspace, EditorPosition } from 'obsidian';
import { Component } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { createTallyState, toMarkedText, type TallyState } from './tally-state';
import {
  buildTallyChip,
  readHostTypography,
  type ZhengTypography,
} from './renderer';
import { dispatchPersistentSuppress, type ResumeToken } from './persistent-tally';
import { getEditorView, resolveEditorHost } from './editor-host';
import {
  dispatchTallyClear,
  dispatchTallySet,
  readTallyAnchor,
  setChipBuilder,
} from './cm6-widget';
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
  /** Resume a persisted (or legacy) tally instead of starting from zero. */
  resume?: ResumeToken;
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
  const { editor, view, leaf, workspace, settings, onSessionEnd, resume } = deps;
  let state: TallyState | null = null;
  let cmView: EditorView | null = null;
  let hostDom: HTMLElement | null = null;
  let baseTypo: ZhengTypography | null = null;
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let isActive = false;
  let anchorOffset: number | null = null;
  let capturedCursor: EditorPosition | null = null;
  let resumeRange: { from: number; to: number } | null = null;
  let suppressActive = false;

  const component = new (class extends Component {
    // Do not call cleanup() here to avoid circular dependency
    // cleanup() will call component.unload() to clean up registered events
  })();
  component.load();

  function currentTypo(): ZhengTypography | null {
    try {
      if (hostDom) {
        const fresh = readHostTypography(hostDom);
        if (fresh && fresh.fontFamily && fresh.fontSize && fresh.color) return fresh;
      }
    } catch {
      // Fall through to base.
    }
    return baseTypo;
  }

  function renderChip(count: number): HTMLElement {
    const typo =
      currentTypo() ??
      baseTypo ??
      ({ fontFamily: 'serif', fontSize: '16px', fontWeight: '400', fontStyle: 'normal', color: 'rgb(0,0,0)', devicePixelRatio: 1 } as ZhengTypography);
    return buildTallyChip(count, typo, () => {
      if (state && isActive && cmView && anchorOffset !== null) {
        state.increment();
        refreshWidget();
      }
    });
  }

  function currentAnchor(): number | null {
    try {
      if (cmView) {
        const mapped = readTallyAnchor(cmView);
        if (mapped !== null && Number.isFinite(mapped) && mapped >= 0) {
          anchorOffset = mapped;
          return mapped;
        }
      }
    } catch {
      // Fall through to captured anchor.
    }
    return anchorOffset;
  }

  function refreshWidget(): void {
    if (!state || !cmView || anchorOffset === null) return;
    const anchor = currentAnchor() ?? anchorOffset;
    try {
      dispatchTallySet(cmView, anchor, state.count);
    } catch {
      // Render failure never breaks counting session.
    }
  }

  function clearSuppress(): void {
    if (!suppressActive) return;
    suppressActive = false;
    try {
      if (cmView) dispatchPersistentSuppress(cmView, null);
    } catch {
      // Ignore teardown races.
    }
  }

  function cleanup(): void {
    if (isActive) {
      isActive = false;
    }

    if (keydownHandler) {
      window.removeEventListener('keydown', keydownHandler, true);
      keydownHandler = null;
    }

    component.unload();

    try {
      if (cmView) dispatchTallyClear(cmView);
    } catch {
      // Ignore teardown races.
    }
    clearSuppress();
    try {
      setChipBuilder(null);
    } catch {
      // Ignore teardown races.
    }
    state = null;
    cmView = null;
    hostDom = null;
    baseTypo = null;
    anchorOffset = null;
    capturedCursor = null;
    resumeRange = null;
    onSessionEnd();
  }

  function commitAndClose(): void {
    if (!state || !isActive || !capturedCursor) {
      cleanup();
      return;
    }
    const viewForAnchor = cmView;
    const mapped = viewForAnchor ? currentAnchor() : anchorOffset;
    try {
      if (viewForAnchor) dispatchTallyClear(viewForAnchor);
    } catch {
      // Continue to single doc insertion.
    }
    try {
      setChipBuilder(null);
    } catch {
      // Continue to single doc insertion.
    }
    if (resumeRange && viewForAnchor) {
      // Resume path: exactly one document transaction replaces the whole
      // stable text + marker (or deletes both when the count reaches zero).
      // The persistent decoration returns on suppress release below.
      const marked = toMarkedText(state.count);
      try {
        const fromPos = editor.offsetToPos(resumeRange.from);
        const toPos = editor.offsetToPos(resumeRange.to);
        editor.replaceRange(marked, fromPos, toPos);
      } catch {
        // Commit failure still tears down without leaking widget/listeners.
      }
      cleanup();
      return;
    }
    const text = settings.commitFormat === 'unicode' ? state.toUnicodeText() : toMarkedText(state.count);
    if (text) {
      try {
        let pos = capturedCursor;
        if (mapped !== null && mapped !== undefined) {
          try {
            pos = editor.offsetToPos(mapped);
          } catch {
            pos = capturedCursor;
          }
        }
        editor.replaceRange(text, pos);
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
        refreshWidget();
      } else if (e.key === 'Backspace' || isMinusKey(e)) {
        state.decrement();
        refreshWidget();
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
      const resolvedView = getEditorView(editor);
      if (!resolvedView) return false;

      state = createTallyState(0);
      cmView = resolvedView;
      hostDom = resolved.dom;
      baseTypo = resolved.typography;
      anchorOffset = resolved.offset;
      resumeRange = null;
      suppressActive = false;
      if (resume) {
        if (!Number.isSafeInteger(resume.count) || resume.count < 0) return false;
        if (!Number.isSafeInteger(resume.from) || !Number.isSafeInteger(resume.to)) return false;
        if (resume.from < 0 || resume.to <= resume.from) return false;
        state = createTallyState(resume.count);
        anchorOffset = resume.from;
        resumeRange = { from: resume.from, to: resume.to };
        // The persistent decoration must stand down while the active widget
        // owns this range; without suppression fail closed (no duplicate UI).
        if (!dispatchPersistentSuppress(cmView, resumeRange)) {
          state = null;
          cmView = null;
          hostDom = null;
          baseTypo = null;
          anchorOffset = null;
          resumeRange = null;
          return false;
        }
        suppressActive = true;
      }

      try {
        capturedCursor = editor.getCursor();
      } catch {
        clearSuppress();
        state = null;
        cmView = null;
        hostDom = null;
        baseTypo = null;
        anchorOffset = null;
        resumeRange = null;
        return false;
      }
      if (!capturedCursor) {
        clearSuppress();
        state = null;
        cmView = null;
        hostDom = null;
        baseTypo = null;
        anchorOffset = null;
        resumeRange = null;
        return false;
      }

      try {
        setChipBuilder((count: number) => renderChip(count));
      } catch {
        clearSuppress();
        state = null;
        cmView = null;
        hostDom = null;
        baseTypo = null;
        anchorOffset = null;
        resumeRange = null;
        return false;
      }

      let mounted = false;
      try {
        mounted = dispatchTallySet(cmView, anchorOffset, state ? state.count : 0);
      } catch {
        mounted = false;
      }
      if (!mounted) {
        try {
          setChipBuilder(null);
        } catch {
          // Ignore teardown races.
        }
        clearSuppress();
        state = null;
        cmView = null;
        hostDom = null;
        baseTypo = null;
        anchorOffset = null;
        capturedCursor = null;
        resumeRange = null;
        return false;
      }

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
