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

  // --- regressions found against a real vault note -------------------------

  test('a trailing space before the marker does not block the chip', () => {
    // A soft line break renders as whitespace; the author did not mean to
    // say anything about the tally by leaving it there.
    const p = paragraphWithMarker('19.雅思学习天数：·2 ', 'zt:2');
    renderTalliesInElement(p);
    expect(chipCount(p)).toBe('2');
    // The trailing space goes away with the tail, not into the prefix.
    expect(p.firstChild!.nodeValue).toBe('19.雅思学习天数：');
  });

  test('an inline <code> elsewhere in the paragraph does not veto the tally', () => {
    // The code element is a *sibling branch*, not an ancestor of the marker.
    // Walking ancestors without stopping at the shared parent used to reject
    // this and leave `·2` as raw text in reading view.
    const p = document.createElement('p');
    p.appendChild(document.createTextNode('19.雅思学习天数：·2'));
    p.appendChild(document.createComment('zt:2'));
    const code = document.createElement('code');
    code.textContent = '示例';
    p.appendChild(code);
    renderTalliesInElement(p);
    expect(chipCount(p)).toBe('2');
    // The code element is untouched and still present.
    expect(p.querySelector('code')!.textContent).toBe('示例');
  });

  test('a tally that genuinely lives inside <code> is still left alone', () => {
    // The sibling-scope relaxation must not open a hole for real code.
    const p = document.createElement('p');
    const code = document.createElement('code');
    code.textContent = '·2';
    p.appendChild(code);
    code.appendChild(document.createComment('zt:2'));
    renderTalliesInElement(p);
    expect(p.querySelector('.zheng-tally-inline')).toBeNull();
  });

  // --- Obsidian strips HTML comments before post processors run ------------
  //
  // Reading view sanitizes its HTML with DOMPurify. The build Obsidian ships
  // has no `ALLOW_COMMENTS` option and drops every HTML comment, so by the
  // time a post processor sees the DOM, `<!--zt:2-->` is gone and only `·2`
  // remains. Everything below therefore supplies the block's *original
  // Markdown* through the `sectionText` argument, which is what the plugin
  // actually does via `ctx.getSectionInfo(el).text`.

  test('renders with no comment node at all, from the source text', () => {
    // This is the real reading-view case: sanitizer already removed the marker.
    const p = paragraphWithMarker('19.雅思学习天数：·2', '');
    renderTalliesInElement(p, true, '19.雅思学习天数：·2<!--zt:2-->');
    expect(chipCount(p)).toBe('2');
    expect(p.firstChild!.nodeValue).toBe('19.雅思学习天数：');
  });

  test('the reported homepage case renders in reading view', () => {
    const src = [
      '17.健身房：正<!--zt:5-->',
      '19.雅思学习天数：·2<!--zt:2-->',
    ].join('\n');

    const p17 = paragraphWithMarker('17.健身房：正', '');
    renderTalliesInElement(p17, true, src);
    expect(chipCount(p17)).toBe('5');

    const p19 = paragraphWithMarker('19.雅思学习天数：·2', '');
    renderTalliesInElement(p19, true, src);
    expect(chipCount(p19)).toBe('2');
  });

  test('duplicate visible halves get their own counts from context', () => {
    // Two tallies with the *same* stable text in one block. Each DOM node must
    // still resolve, and the index must consume entries so the second lookup
    // does not silently re-use the first one's count.
    const src = '早：·2<!--zt:2--> 晚：·2<!--zt:2-->';

    const morning = paragraphWithMarker('早：·2', '');
    renderTalliesInElement(morning, true, src);
    expect(chipCount(morning)).toBe('2');

    const evening = paragraphWithMarker('晚：·2', '');
    renderTalliesInElement(evening, true, src);
    expect(chipCount(evening)).toBe('2');
  });

  test('distinct counts in one block each resolve to the right one', () => {
    // 6 -> 正·1 ; 11 -> 正正·1. Different visible halves, so this exercises
    // the index lookup rather than the ordering fallback.
    const src = '早：正·1<!--zt:6--> 晚：正正·1<!--zt:11-->';

    const morning = paragraphWithMarker('早：正·1', '');
    renderTalliesInElement(morning, true, src);
    expect(chipCount(morning)).toBe('6');

    const evening = paragraphWithMarker('晚：正正·1', '');
    renderTalliesInElement(evening, true, src);
    expect(chipCount(evening)).toBe('11');
  });

  test('same visible half twice: order decides which is consumed', () => {
    // Both render as `正·1` (6 and 6). The first DOM node must take the first
    // marker, so the index has to consume entries rather than return a shared
    // value for every lookup.
    const src = '甲：正·1<!--zt:6--> 乙：正·1<!--zt:6-->';

    const first = paragraphWithMarker('甲：正·1', '');
    renderTalliesInElement(first, true, src);
    expect(chipCount(first)).toBe('6');

    const second = paragraphWithMarker('乙：正·1', '');
    renderTalliesInElement(second, true, src);
    expect(chipCount(second)).toBe('6');
  });

  test('falls back to order when the preceding text was rewritten', () => {
    // Resolving a link or an emoji shortcode changes the rendered text before
    // the tally, so context matching fails; order still has to hold.
    const src = '见[[某笔记]]：·3<!--zt:3-->';
    const p = paragraphWithMarker('见某笔记：·3', '');
    renderTalliesInElement(p, true, src);
    expect(chipCount(p)).toBe('3');
  });

  test('source text with no tallies changes nothing', () => {
    const p = paragraphWithMarker('普通段落：·2', '');
    renderTalliesInElement(p, true, '普通段落，没有任何标记');
    expect(chipCount(p)).toBeNull();
    expect(p.textContent).toBe('普通段落：·2');
  });

  test('a marker in the source that disagrees with the visible half fails closed', () => {
    // Source says 9, DOM shows `·2`. Ownership check must reject it.
    const p = paragraphWithMarker('·2', '');
    renderTalliesInElement(p, true, '·2<!--zt:9-->');
    expect(chipCount(p)).toBeNull();
    expect(p.textContent).toBe('·2');
  });

  test('source pass does not reach into code blocks', () => {
    const p = document.createElement('p');
    const code = document.createElement('code');
    code.textContent = '·2';
    p.appendChild(code);
    renderTalliesInElement(p, true, '·2<!--zt:2-->');
    expect(p.querySelector('.zheng-tally-inline')).toBeNull();
  });

  test('a heading renders from source too', () => {
    const h = document.createElement('h2');
    h.textContent = '进度 ·4';
    renderTalliesInElement(h, true, '## 进度 ·4<!--zt:4-->');
    expect(chipCount(h)).toBe('4');
  });
});
