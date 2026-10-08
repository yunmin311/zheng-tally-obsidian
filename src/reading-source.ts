import { parseMarkedTallies, stableTextForCount } from './tally-state';

export interface ReadingHit { from: number; to: number; count: number }

/** Markdown may render emphasis delimiters as formatting or literal text.
 * Ignore them only during alignment; DOM edits preserve every delimiter. */
export function isReadingAlignmentDelimiter(char: string): boolean {
  return /[\s*_~`]/.test(char);
}

// Decode only the references supported by this conservative projection.
// Never parse source text as HTML, even in a detached element.
const namedReferences: Readonly<Record<string, string>> = {
  amp: '&', AMP: '&', lt: '<', LT: '<', gt: '>', GT: '>',
  quot: '"', QUOT: '"', apos: "'",
};
const legacyNumericReferences: Readonly<Record<number, number>> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e,
  0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

function decodeReference(entity: string): string {
  const name = entity.slice(1, -1);
  if (!name.startsWith('#')) return namedReferences[name] ?? entity;
  const hex = name[1]?.toLowerCase() === 'x';
  let codePoint = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
  if (!Number.isFinite(codePoint) || codePoint === 0 || codePoint > 0x10ffff
    || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return '\uFFFD';
  codePoint = legacyNumericReferences[codePoint] ?? codePoint;
  return String.fromCodePoint(codePoint);
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
    .replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, decodeReference)
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
