import type { MarkdownPostProcessor, Plugin } from 'obsidian';
import { registerReadingTallies, renderTalliesInElement } from '../src/reading-tally';

const counts = (el: HTMLElement) => Array.from(el.querySelectorAll('.zheng-tally-inline'))
  .map(chip => chip.getAttribute('data-count'));

describe('sanitized reading source ownership', () => {
  test('plain list text cannot consume a later marked tally', () => {
    const ul = document.createElement('ul');
    ul.innerHTML = '<li>普通汉字：正</li><li>计数：正</li>';
    renderTalliesInElement(ul, true, '- 普通汉字：正\n- 计数：正<!--zt:5-->');
    expect(counts(ul.children[0] as HTMLElement)).toEqual([]);
    expect(counts(ul.children[1] as HTMLElement)).toEqual(['5']);
  });

  test('marked tallies in the middle of prose retain the suffix', () => {
    const p = document.createElement('p');
    p.textContent = '已完成正，明天继续';
    renderTalliesInElement(p, true, '已完成正<!--zt:5-->，明天继续');
    expect(counts(p)).toEqual(['5']);
    expect(p.lastChild?.textContent).toBe('，明天继续');
  });

  test('local two-line input renders both counts after comment stripping', () => {
    const p = document.createElement('p');
    p.textContent = '健身房：正·3\n雅思：·2';
    renderTalliesInElement(p, true, '健身房：正·3<!--zt:8-->\n雅思：·2<!--zt:2-->');
    expect(counts(p)).toEqual(['8', '2']);
  });

  test('same visible text can occur as plain text and owned text in one node', () => {
    const p = document.createElement('p');
    p.textContent = '普通正；计数正；结尾正';
    renderTalliesInElement(p, true, '普通正；计数正<!--zt:5-->；结尾正');
    expect(counts(p)).toEqual(['5']);
    expect(p.firstChild?.textContent).toBe('普通正；计数');
    expect(p.lastChild?.textContent).toBe('；结尾正');
  });

  test('formatted text and resolved link retain source ownership', () => {
    const p = document.createElement('p');
    p.innerHTML = '见<a>别名</a>：<strong>正</strong>，以及<em>·2</em>。';
    renderTalliesInElement(p, true, '见[[某笔记|别名]]：**正<!--zt:5-->**，以及*·2<!--zt:2-->*。');
    expect(counts(p)).toEqual(['5', '2']);
    expect(p.querySelector('a')?.textContent).toBe('别名');
  });

  test('code contents are not claimed and a second pass changes nothing', () => {
    const p = document.createElement('p');
    p.innerHTML = '<code>正</code>；计数正';
    const src = '`正<!--zt:5-->`；计数正<!--zt:5-->';
    renderTalliesInElement(p, true, src);
    const first = p.innerHTML;
    renderTalliesInElement(p, true, src);
    expect(p.querySelector('code')?.textContent).toBe('正');
    expect(counts(p)).toEqual(['5']);
    expect(p.innerHTML).toBe(first);
  });

  test('ambiguous identical unmarked and marked sections fail closed', () => {
    const p = document.createElement('p');
    p.textContent = '正';
    renderTalliesInElement(p, true, '正\n\n正<!--zt:5-->');
    expect(counts(p)).toEqual([]);
  });

  test('post processor limits full-document source to the reported lines', () => {
    let callback: MarkdownPostProcessor | undefined;
    const plugin = { registerMarkdownPostProcessor: (fn: MarkdownPostProcessor) => { callback = fn; } };
    registerReadingTallies(plugin as unknown as Plugin);
    const p = document.createElement('p');
    p.textContent = '正';
    const text = '正\r\n\r\n正<!--zt:5-->';
    callback!(p, { getSectionInfo: () => ({ text, lineStart: 0, lineEnd: 0 }) } as never);
    expect(counts(p)).toEqual([]);
    callback!(p, { getSectionInfo: () => ({ text, lineStart: 2, lineEnd: 2 }) } as never);
    expect(counts(p)).toEqual(['5']);
  });

  test('quoted content retains ownership without changing its ordinary 正', () => {
    const quote = document.createElement('blockquote');
    quote.innerHTML = '<p>普通正；计数正</p>';
    renderTalliesInElement(quote, true, '> 普通正；计数正<!--zt:5-->');
    expect(counts(quote)).toEqual(['5']);
    expect(quote.querySelector('p')?.firstChild?.textContent).toBe('普通正；计数');
  });

  test('fenced-code markers cannot steal a prose marker', () => {
    const root = document.createElement('div');
    root.innerHTML = '<pre><code>正</code></pre><p>计数正</p>';
    renderTalliesInElement(root, true, '```text\n正<!--zt:5-->\n```\n计数正<!--zt:5-->');
    expect(counts(root.querySelector('pre')!)).toEqual([]);
    expect(counts(root.querySelector('p')!)).toEqual(['5']);
  });

  test('unsupported transformed text never claims an unowned lookalike', () => {
    const p = document.createElement('p');
    p.textContent = '插件改写了文字：正';
    renderTalliesInElement(p, true, '原文正<!--zt:5-->');
    expect(counts(p)).toEqual([]);
  });

  test('invalid line ranges do not fall back to whole-file ownership', () => {
    let callback: MarkdownPostProcessor | undefined;
    registerReadingTallies({ registerMarkdownPostProcessor: (fn: MarkdownPostProcessor) => { callback = fn; } } as unknown as Plugin);
    const p = document.createElement('p');
    p.textContent = '正';
    callback!(p, { getSectionInfo: () => ({ text: '正<!--zt:5-->', lineStart: -1, lineEnd: 100 }) } as never);
    expect(counts(p)).toEqual([]);
  });

  test('post processor rejects a transformed partial section instead of guessing', () => {
    let callback: MarkdownPostProcessor | undefined;
    registerReadingTallies({ registerMarkdownPostProcessor: (fn: MarkdownPostProcessor) => { callback = fn; } } as unknown as Plugin);
    const p = document.createElement('p');
    p.textContent = '正';
    callback!(p, { getSectionInfo: () => ({ text: '原文正<!--zt:5-->', lineStart: 0, lineEnd: 0 }) } as never);
    expect(counts(p)).toEqual([]);
  });

  test('literal emphasis delimiters around a tally remain visible', () => {
    const p = document.createElement('p');
    // Markdown may keep * literal when its delimiter boundary is not valid.
    p.innerHTML = '<strong>正</strong>，以及*·2*。';
    renderTalliesInElement(p, true, '**正<!--zt:5-->**，以及*·2<!--zt:2-->*。', true);
    expect(counts(p)).toEqual(['5', '2']);
    expect(p.lastChild?.textContent).toBe('*。');
  });
});
