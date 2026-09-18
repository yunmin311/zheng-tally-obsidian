import { Plugin, MarkdownView, Notice, type Editor, type MarkdownFileInfo } from 'obsidian';
import { loadSettings, type Settings } from './settings';
import { createEditorSession, type EditorSession } from './editor-session';
import { tallyExtension } from './cm6-widget';
import { registerTallyHover } from './tally-hover';
import {
  createPersistentTallyExtension,
  findResumeToken,
  type ResumeToken,
} from './persistent-tally';

export default class ZhengTallyPlugin extends Plugin {
  declare settings: Settings;
  private activeSession: EditorSession | null = null;

  async onload(): Promise<void> {
    this.settings = await loadSettings(this);
    this.registerEditorExtension(tallyExtension);
    registerTallyHover(this);
    this.registerEditorExtension(
      createPersistentTallyExtension((token: ResumeToken) => {
        this.resumeTallyFromChip(token);
      }),
    );

    this.addCommand({
      // NOTE: Obsidian prefixes command IDs with the plugin ID automatically,
      // so the bare `start` ID is a submission-compliance requirement.
      // The name must not repeat the plugin name (Obsidian already shows it
      // beside the command).
      id: 'start',
      name: 'Start counting',
      // The directory review lists a default hotkey as a Warning (possible
      // conflict), not an Error. It is kept deliberately: without it the plugin
      // ships with no way to start a tally, which is worse than the warning.
      // `Alt+Z` is not bound by Obsidian by default, so there is no real clash;
      // users can rebind it under Settings → Hotkeys as usual.
      hotkeys: [{ modifiers: ['Alt'], key: 'z' }],
      editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        if (ctx instanceof MarkdownView) {
          this.startOrResumeTally(editor, ctx);
        }
      },
    });

    this.registerInterval(
      window.setInterval(() => {
        if (this.activeSession && !this.isEditorActive()) {
          this.activeSession.destroy();
          this.activeSession = null;
        }
      }, 500)
    );
  }

  onunload(): void {
    if (this.activeSession) {
      this.activeSession.destroy();
      this.activeSession = null;
    }
  }

  private isEditorActive(): boolean {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view !== null && view.editor !== undefined;
  }

  /**
   * Alt+Z entry: resume when the caret sits on (or directly adjacent to) a
   * plugin-owned marked tally, or uniquely inside a legacy conservative
   * token (which upgrades to marked form on commit). Otherwise start fresh.
   */
  private startOrResumeTally(editor: Editor, view: MarkdownView): void {
    if (this.activeSession) {
      new Notice('Zheng Tally: session already active');
      return;
    }
    let resume: ResumeToken | undefined;
    try {
      const cursor = editor.getCursor();
      const offset = editor.posToOffset(cursor);
      const doc = editor.getValue();
      const hit = findResumeToken(doc, offset);
      if (hit) resume = hit;
    } catch {
      resume = undefined;
    }
    this.startTallySession(editor, view, resume);
  }

  /** Click on a persistent chip resumes that exact count (never from zero). */
  private resumeTallyFromChip(token: ResumeToken): void {
    if (this.activeSession) return;
    try {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || !view.editor) return;
      const leaf = this.app.workspace.activeLeaf;
      if (!leaf) return;
      this.startTallySession(view.editor, view, token);
    } catch {
      // Resume is best-effort; never break the editor.
    }
  }

  private startTallySession(editor: Editor, view: MarkdownView, resume?: ResumeToken): void {
    if (this.activeSession) {
      new Notice('Zheng Tally: session already active');
      return;
    }

    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) {
      new Notice('Zheng Tally: no active leaf');
      return;
    }

    const session = createEditorSession({
      editor,
      view,
      leaf,
      workspace: this.app.workspace,
      settings: this.settings,
      onSessionEnd: () => {
        this.activeSession = null;
      },
      ...(resume ? { resume } : {}),
    });

    if (session.start()) {
      this.activeSession = session;
    } else {
      session.destroy();
      new Notice('Zheng Tally: could not start session');
    }
  }
}