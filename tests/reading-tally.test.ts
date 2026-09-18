import { renderTalliesInElement } from '../src/reading-tally';

/** Build `<p>` with text + the comment node Obsidian's renderer produces. */
function paragraphWithMarker(text: string, marker: string): HTMLElement {
  const p = document.createElement('p');
  p.appendChild(document.createTextNode(text));
  if (marker !== '') p.appendChild(document.createComment(marker));
  return p;
}

function chipCount(el: HTMLElement): string | null {
  const chip = el.querySelector('.zheng-tally-inline');
  return chip ? chip.getAttribute('data-count') : null;
}

describe('reading-view tallies', () => {
  test('renders a chip for a marked tally (comment node)', () => {
    const p = paragraphWithMarker('健身房：·4', 'zt:4');
    renderTalliesInElement(p);
    expect(chipCount(p)).toBe('4');
    expect(p.querySelector('.zheng-tally-inline')!.getAttribute('data-reading')).toBe('true');
  });

  test('keeps the text before the tally, in its own text node', () => {
    const p = paragraphWithMarker('17.健身房：·4', 'zt:4');
    renderTalliesInElement(p);
    // The visible tail is gone; the chip carries the count itself.
    expect(p.firstChild!.nodeType).toBe(3);
    expect(p.firstChild!.nodeValue).toBe('17.健身房：');
    expect(p.childNodes.length).toBe(2);
  });

  test('multi-group tally: 正正正·3 + zt:18', () => {
    const p = paragraphWithMarker('雅思：正正正·3', 'zt:18');
    renderTalliesInElement(p);
    expect(chipCount(p)).toBe('18');
  });

  test('fails closed when the marker disagrees with the visible text', () => {
    const p = paragraphWithMarker('·2', 'zt:9');
    renderTalliesInElement(p);
    expect(chipCount(p)).toBeNull();
    // Untouched: still the original text plus the comment.
    expect(p.textContent).toBe('·2');
  });

  test('ignores unrelated HTML comments', () => {
    const p = paragraphWithMarker('·3', 'a normal note comment');
    renderTalliesInElement(p);
    expect(chipCount(p)).toBeNull();
    expect(p.textContent).toBe('·3');
  });

  test('renders a literal marker inside one text node', () => {
    const p = document.createElement('p');
    // 12 -> 正正·2 (stable text), which is what the marker must re-serialize to.
    p.textContent = '计数：正正·2<!--zt:12-->';
    renderTalliesInElement(p);
    expect(chipCount(p)).toBe('12');
  });

  test('a literal marker whose text disagrees is left alone', () => {
    const p = document.createElement('p');
    p.textContent = '计数：正正·3<!--zt:12-->';
    renderTalliesInElement(p);
    expect(chipCount(p)).toBeNull();
  });

  test('several tallies in one paragraph', () => {
    const p = document.createElement('p');
    p.textContent = 'a 正正·2<!--zt:12--> b ·1<!--zt:1--> c';
    renderTalliesInElement(p);
    const chips = Array.from(p.querySelectorAll('.zheng-tally-inline')).map((c) =>
      c.getAttribute('data-count'),
    );
    expect(chips).toEqual(['12', '1']);
    // Prefixes and suffixes survive, in order.
    expect(p.textContent!.startsWith('a ')).toBe(true);
    expect(p.textContent!.endsWith(' c')).toBe(true);
  });

  test('code blocks are left alone', () => {
    const pre = document.createElement('pre');
    pre.appendChild(document.createElement('code')).textContent = '·4';
    pre.appendChild(document.createComment('zt:4'));
    renderTalliesInElement(pre);
    expect(pre.querySelector('.zheng-tally-inline')).toBeNull();
  });

  test('a legacy bare 正 with no marker is never chipped', () => {
    const p = paragraphWithMarker('正正', '');
    renderTalliesInElement(p);
    expect(chipCount(p)).toBeNull();
    expect(p.textContent).toBe('正正');
  });

  test('a second pass does not nest chips', () => {
    const p = paragraphWithMarker('健身房：·4', 'zt:4');
    renderTalliesInElement(p);
    renderTalliesInElement(p);
    expect(p.querySelectorAll('.zheng-tally-inline').length).toBe(1);
  });
});
