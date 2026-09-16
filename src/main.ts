import { Plugin, MarkdownView, Notice, type Editor, type MarkdownFileInfo } from 'obsidian';
import { loadSettings, type Settings } from './settings';
import { createEditorSession, type EditorSession } from './editor-session';
import { tallyExtension } from './cm6-widget';
import { registerTallyHover } from './tally-hover';

export default class ZhengTallyPlugin extends Plugin {
  declare settings: Settings;
  private activeSession: EditorSession | null = null;

  async onload(): Promise<void> {
    this.settings = await loadSettings(this);
    this.registerEditorExtension(tallyExtension);
    registerTallyHover(this);

    this.addCommand({
      id: 'zheng-tally:start',
      name: 'Start Zheng Tally counting',
      hotkeys: [{ modifiers: ['Alt'], key: 'z' }],
      editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        if (ctx instanceof MarkdownView) {
          this.startTallySession(editor, ctx);
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

  private startTallySession(editor: Editor, view: MarkdownView): void {
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
    });

    if (session.start()) {
      this.activeSession = session;
    } else {
      session.destroy();
      new Notice('Zheng Tally: could not start session');
    }
  }
}