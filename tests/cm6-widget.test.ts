import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import {
  dispatchTallyClear,
  dispatchTallySet,
  ensureTallyField,
  hasTallyDecoration,
  readTallyAnchor,
  setChipBuilder,
  tallyExtension,
  tallyField,
  TallyWidget,
} from '../src/cm6-widget';

const chip = (count: number): HTMLElement => {
  const el = document.createElement('span');
  el.className = 'zheng-tally-inline';
  el.textContent = `chip-${count}`;
  return el;
};

afterEach(() => {
  document.body.innerHTML = '';
  setChipBuilder(null);
});

function makeView(doc = 'AAA BBB'): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({ doc, extensions: [tallyExtension], parent });
}

describe('cm6 true inline widget', () => {
  test('normal widget is Decoration/WidgetType (not absolute/fixed)', () => {
    setChipBuilder(chip);
    const view = makeView();
    expect(dispatchTallySet(view, 4, 3)).toBe(true);
    expect(hasTallyDecoration(view)).toBe(true);
    expect(readTallyAnchor(view)).toBe(4);
    const widget = view.dom.querySelector('.zheng-tally-inline') as HTMLElement | null;
    expect(widget).not.toBeNull();
    // Must participate in layout: no absolute/fixed positioning.
    const pos = widget!.style.position;
    expect(pos === '' || pos === 'static' || pos === 'relative').toBe(true);
    expect(widget!.style.position).not.toBe('absolute');
    expect(widget!.style.position).not.toBe('fixed');
    const html = view.dom.innerHTML;
    expect(html).not.toContain('position:absolute');
    expect(html).not.toContain('position:fixed');
    view.destroy();
  });

  test('TallyWidget is a WidgetType with eq by count', () => {
    const a = new TallyWidget(2, chip);
    expect(a).toBeInstanceOf(WidgetType);
    expect(a.eq(new TallyWidget(2, chip))).toBe(true);
    expect(a.eq(new TallyWidget(3, chip))).toBe(false);
    const el = a.toDOM();
    expect(el.className).toContain('zheng-tally-inline');
  });

  test('scroll/mapping: anchor follows document transaction', () => {
    setChipBuilder(chip);
    const view = makeView('AAA BBB');
    expect(dispatchTallySet(view, 4, 1)).toBe(true);
    expect(readTallyAnchor(view)).toBe(4);
    view.dispatch({ changes: { from: 0, insert: 'XX' } });
    expect(view.state.doc.toString()).toBe('XXAAA BBB');
    expect(readTallyAnchor(view)).toBe(6);
    expect(hasTallyDecoration(view)).toBe(true);
    view.destroy();
  });

  test('clear removes decoration without doc mutation', () => {
    setChipBuilder(chip);
    const view = makeView('AAA BBB');
    dispatchTallySet(view, 4, 2);
    const before = view.state.doc.toString();
    expect(dispatchTallyClear(view)).toBe(true);
    expect(hasTallyDecoration(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(before);
    view.destroy();
  });

  test('update via set effect changes count in place', () => {
    setChipBuilder(chip);
    const view = makeView('AAA BBB');
    dispatchTallySet(view, 4, 1);
    expect(view.dom.textContent).toContain('chip-1');
    dispatchTallySet(view, 4, 2);
    expect(view.dom.textContent).toContain('chip-2');
    view.destroy();
  });

  test('ensureTallyField appends config when missing', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const bare = new EditorView({ doc: 'AAA', parent });
    expect(() => bare.state.field(tallyField, false)).not.toThrow();
    expect(ensureTallyField(bare)).toBe(true);
    setChipBuilder(chip);
    expect(dispatchTallySet(bare, 1, 1)).toBe(true);
    expect(hasTallyDecoration(bare)).toBe(true);
    bare.destroy();
  });

  test('set without builder fails closed (no widget)', () => {
    setChipBuilder(null);
    const view = makeView('AAA');
    expect(dispatchTallySet(view, 1, 1)).toBe(false);
    expect(hasTallyDecoration(view)).toBe(false);
    view.destroy();
  });

  test('decoration type is widget (side 1) at anchor', () => {
    setChipBuilder(chip);
    const view = makeView('abcdef');
    dispatchTallySet(view, 3, 1);
    const deco = view.state.field(tallyField, false);
    expect(deco).toBeDefined();
    let widgetFound = false;
    deco!.between(0, view.state.doc.length, (from, _to, value) => {
      if (value.spec.widget instanceof TallyWidget) {
        widgetFound = true;
        expect(from).toBe(3);
      }
      return false;
    });
    expect(widgetFound).toBe(true);
    expect(Decoration).toBeDefined();
    view.destroy();
  });
});
