// Mock Component class for testing (mimics Obsidian's official Component API)
export class Component {
  private events: Array<{ off: () => void }> = [];
  private domEvents: Array<{ el: EventTarget; type: string; handler: EventListener; options?: boolean | AddEventListenerOptions }> = [];
  private _loaded = false;
  private _unloaded = false;

  get loaded(): boolean {
    return this._loaded;
  }

  get unloaded(): boolean {
    return this._unloaded;
  }

  load(): void {
    if (this._loaded) {
      throw new Error('Component already loaded');
    }
    this._loaded = true;
    this._unloaded = false;
  }

  registerEvent(eventRef: { off: () => void }): void {
    if (!this._loaded) {
      throw new Error('Component.registerEvent() called before load()');
    }
    if (this._unloaded) {
      throw new Error('Component.registerEvent() called after unload()');
    }
    this.events.push(eventRef);
  }

  registerDomEvent(el: EventTarget, type: string, handler: EventListener, options?: boolean | AddEventListenerOptions): void {
    if (!this._loaded) {
      throw new Error('Component.registerDomEvent() called before load()');
    }
    if (this._unloaded) {
      throw new Error('Component.registerDomEvent() called after unload()');
    }
    el.addEventListener(type, handler, options);
    this.domEvents.push({ el, type, handler, options });
  }

  unload(): void {
    if (!this._loaded) {
      throw new Error('Component.unload() called before load()');
    }
    if (this._unloaded) {
      return; // idempotent
    }
    this._unloaded = true;
    for (const eventRef of this.events) {
      eventRef.off();
    }
    this.events.length = 0;
    for (const { el, type, handler, options } of this.domEvents) {
      el.removeEventListener(type, handler, options);
    }
    this.domEvents.length = 0;
  }
}

// Re-export types from the actual obsidian types (for type checking)
// Note: at runtime, these are just empty placeholders
export interface EventRef {}
export interface Editor {}
export interface MarkdownView {}
export interface WorkspaceLeaf {}
export interface Workspace {}
export interface EditorPosition {}
export interface EditorPosition {}
export interface MarkdownFileInfo {}
export interface TFile {}
export interface TAbstractFile {}
export interface CachedMetadata {}
export interface Menu {}
export interface Tasks {}
export interface ClipboardEvent {}
export interface DragEvent {}
export interface WorkspaceWindow {}