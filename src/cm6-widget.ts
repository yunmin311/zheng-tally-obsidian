import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

export type TallyChipBuilder = (count: number) => HTMLElement;

let currentBuilder: TallyChipBuilder | null = null;

export function setChipBuilder(builder: TallyChipBuilder | null): void {
  currentBuilder = builder;
}

export class TallyWidget extends WidgetType {
  constructor(
    readonly count: number,
    readonly builder: TallyChipBuilder,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    return this.builder(this.count);
  }

  eq(other: TallyWidget): boolean {
    return other instanceof TallyWidget && other.count === this.count && other.builder === this.builder;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export const setTallyEffect = StateEffect.define<{ anchor: number; count: number }>();
export const clearTallyEffect = StateEffect.define<void>();

export const tallyField: StateField<DecorationSet> = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setTallyEffect)) {
        const { anchor, count } = e.value;
        const builder = currentBuilder;
        if (!builder) return Decoration.none;
        const safeAnchor = Math.max(0, Math.min(anchor, tr.state.doc.length));
        const widget = Decoration.widget({ widget: new TallyWidget(count, builder), side: 1 });
        return Decoration.set([widget.range(safeAnchor)]);
      }
      if (e.is(clearTallyEffect)) {
        return Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const tallyExtension: Extension = [tallyField];

export function hasTallyDecoration(view: EditorView): boolean {
  try {
    const deco = view.state.field(tallyField, false);
    if (!deco) return false;
    let found = false;
    deco.between(0, view.state.doc.length, () => {
      found = true;
      return false;
    });
    return found;
  } catch {
    return false;
  }
}

export function readTallyAnchor(view: EditorView): number | null {
  try {
    const deco = view.state.field(tallyField, false);
    if (!deco) return null;
    let anchor: number | null = null;
    deco.between(0, view.state.doc.length, (from) => {
      if (anchor === null) anchor = from;
      return false;
    });
    return anchor;
  } catch {
    return null;
  }
}

export function ensureTallyField(view: EditorView): boolean {
  try {
    const existing = view.state.field(tallyField, false);
    if (existing !== undefined) return true;
  } catch {
    // Field absent; append below.
  }
  try {
    view.dispatch({ effects: StateEffect.appendConfig.of(tallyExtension) });
    return true;
  } catch {
    return false;
  }
}

export function dispatchTallySet(view: EditorView, anchor: number, count: number): boolean {
  try {
    if (!currentBuilder) return false;
    if (!ensureTallyField(view)) return false;
    const safeAnchor = Math.max(0, Math.min(anchor, view.state.doc.length));
    view.dispatch({ effects: setTallyEffect.of({ anchor: safeAnchor, count }) });
    return true;
  } catch {
    return false;
  }
}

export function dispatchTallyClear(view: EditorView): boolean {
  try {
    view.dispatch({ effects: clearTallyEffect.of(undefined) });
    return true;
  } catch {
    return false;
  }
}
