import { parseMarkedTallies, stableTextForCount } from './tally-state';

export interface ReadingHit { from: number; to: number; count: number }

/** Markdown may render emphasis delimiters as formatting or literal text.
 * Ignore them only during alignment; DOM edits preserve every delimiter. */
export function isReadingAlignmentDelimiter(char: string): boolean {
  return /[\s*_~`]/.test(char);
}

/** Conservative text projection for ownership alignment, not a Markdown
 * renderer. Unsupported transformations fail alignment rather than guess. */
function project(source: string): string {
  return source
    .replace(/<!--[^]*?-->/g, '')
    .replace(/^\s*(`{3,}|~{3,})[^\n]*$/gm, '')
    .replace(/^\s*(?:>\s*)+/gm, '')
    .replace(/^\s*(?:>\s*)*(?:#{1,6}\s+|[-+*]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/gm, '')
    .replace(/\[\[([^\]\n]+)\]\]/g, (_match, target: string) => target.split('|').pop() ?? target)
    .replace(/\[([^\]\n]*)\]\([^\n)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
      const el = document.createElement('textarea');
      el.innerHTML = entity;
      return el.value;
    })
    .replace(/\s/g, '');
}

/** Sentinels only exist in memory: never written into notes or the DOM. */
export function alignedReadingHits(source: string, renderedText: string, exactSection = false): ReadingHit[] {
  let prefix = '\uE000zt';
  while (source.includes(prefix)) prefix += 'z';
  const tokens = parseMarkedTallies(source, 0);
  let annotated = '', cursor = 0;
  tokens.forEach((token, index) => {
    annotated += source.slice(cursor, token.from) + stableTextForCount(token.count)
      + `${prefix}${index}\uE001`;
    cursor = token.to;
  });
  annotated += source.slice(cursor);
  const projected = project(annotated);
  const sentinel = new RegExp(`${prefix}(\\d+)\uE001`, 'g');
  let text = '', end = 0;
  const hits: ReadingHit[] = [];
  for (const match of projected.matchAll(sentinel)) {
    text += projected.slice(end, match.index);
    const token = tokens[Number(match[1])];
    const visible = stableTextForCount(token.count);
    hits.push({ from: text.length - visible.length, to: text.length, count: token.count });
    end = match.index + match[0].length;
  }
  text += projected.slice(end);
  const rendered = renderedText.replace(/[\s*_~`]/g, '');
  if (!rendered) return [];
  if (exactSection && text !== rendered) return [];
  const start = text.indexOf(rendered);
  // Include ordinary lookalikes in alignment; multiple matches are ambiguous.
  if (start < 0 || text.indexOf(rendered, start + 1) >= 0) return [];
  return hits.filter(hit => hit.from >= start && hit.to <= start + rendered.length)
    .map(hit => ({ ...hit, from: hit.from - start, to: hit.to - start }));
}
