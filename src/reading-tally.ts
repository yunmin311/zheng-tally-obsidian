import type { Plugin } from 'obsidian';
import { buildTallyChip, readHostTypography, type ZhengTypography } from './renderer';
import { parseMarkedTallies, stableTextForCount } from './tally-state';

/**
 * Reading-view rendering for committed tallies.
 *
 * Why this file exists: everything else in the plugin renders through
 * CodeMirror decorations, which only exist in the editor. Reading view goes
 * through Obsidian's MarkdownRenderer, so a committed tally (`正正·3<!--zt:12-->`)
 * used to fall through as raw text — and because the marker is an HTML comment,
 * the reader saw only the visible half (`·3`) with no chip at all.
 *
 * The fix is a post processor, not a second renderer: parsing, ownership
 * verification and chip building are all reused unchanged.
 */

/** Same shape as the one in persistent-tally.ts; duplicated rather than shared
 *  so the reading path keeps working if the editor module changes. */
const FALLBACK_TYPOGRAPHY: ZhengTypography = {
  fontFamily: 'serif',
  fontSize: '16px',
  fontWeight: '400',
  fontStyle: 'normal',
  color: 'rgb(0,0,0)',
  devicePixelRatio: 1,
};

/** Marker as it survives the HTML parse: `<!--zt:12-->` becomes `zt:12`. */
const COMMENT_MARKER_RE = /zt:(\d+)/;

/** Visible half of a marked tally, anchored at the end of a text node. */
const VISIBLE_TAIL_RE = /(正+(?:·[1-4])?|·[1-4])$/;

/**
 * Containers where a tally is source text, not a tally: code, LaTeX output,
 * and anything the plugin already rendered (post processors can run again on
 * the same subtree, and re-chipping a chip would nest them).
 */
const SKIP_TAGS = new Set(['PRE', 'CODE', 'SCRIPT', 'STYLE', 'TEXTAREA']);

function isSkipped(node: Node | null): boolean {
  let cur: Node | null = node;
  while (cur) {
    if (cur.nodeType === 1) {
      const el = cur as HTMLElement;
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.classList && el.classList.contains('zheng-tally-inline')) return true;
    }
    cur = cur.parentNode;
  }
  return false;
}

/**
 * Replace one verified tally at the tail of `text` with a chip.
 * Returns the text node's remaining prefix (or null when nothing matched).
 */
function chipFromTail(
  text: string,
  count: number,
  typo: ZhengTypography,
  showTotal: boolean,
): { prefix: string; chip: HTMLElement } | null {
  const m = VISIBLE_TAIL_RE.exec(text);
  if (!m) return null;
  const visible = m[1];
  // Ownership check, identical to the editor path: the marker only counts
  // when it re-serializes to exactly the visible text. Mismatches fail closed.
  if (stableTextForCount(count) !== visible) return null;
  const prefix = text.slice(0, m.index);
  const chip = buildChip(count, typo, showTotal);
  return { prefix, chip };
}

function buildChip(count: number, typo: ZhengTypography, showTotal: boolean): HTMLElement {
  const chip = buildTallyChip(count, typo, null, 'persisted', showTotal);
  chip.setAttribute('data-reading', 'true');
  return chip;
}

/** Replace `node` with `chip`, keeping `prefix` as the leading text if any. */
function swapIn(parent: Node, node: Node, prefix: string, chip: HTMLElement): void {
  try {
    if (prefix) {
      const lead = parent.ownerDocument
        ? parent.ownerDocument.createTextNode(prefix)
        : document.createTextNode(prefix);
      parent.insertBefore(lead, node);
    }
    parent.insertBefore(chip, node);
    parent.removeChild(node);
  } catch {
    // Never break a render over a chip.
  }
}

/**
 * Main pass. Two sources of truth, both conservative:
 *
 * 1. A comment node (`zt:12`) whose previous sibling ends in the matching
 *    visible tally — the normal case once Obsidian has parsed the note.
 * 2. The full literal `正正·3<!--zt:12-->` inside a single text node — happens
 *    when raw HTML is not parsed (escaped source, some embeds). Same parser
 *    the editor uses.
 *
 * Anything unverified (no marker, marker/text mismatch, legacy bare 正) is
 * left exactly as Markdown rendered it.
 */
export function renderTalliesInElement(root: HTMLElement, showTotal = true): void {
  let typo: ZhengTypography | null = null;
  try {
    typo = readHostTypography(root);
  } catch {
    typo = null;
  }
  const resolved = typo ?? FALLBACK_TYPOGRAPHY;

  // --- pass 1: comment nodes ---
  const doc = root.ownerDocument;
  const comments: Comment[] = [];
  const walker = doc.createTreeWalker(root, 0x80 /* SHOW_COMMENT */);
  let cur = walker.nextNode();
  while (cur) {
    if (cur.nodeType === 8) comments.push(cur as Comment);
    cur = walker.nextNode();
  }

  for (const comment of comments) {
    try {
      if (isSkipped(comment)) continue;
      const m = COMMENT_MARKER_RE.exec(comment.nodeValue ?? '');
      if (!m) continue;
      const count = Number(m[1]);
      if (!Number.isSafeInteger(count) || count <= 0) continue;
      const prev = comment.previousSibling;
      if (!prev || prev.nodeType !== 3 || !prev.nodeValue) continue;
      const hit = chipFromTail(prev.nodeValue, count, resolved, showTotal);
      if (!hit) continue;
      const parent = prev.parentNode;
      if (!parent) continue;
      swapIn(parent, prev, hit.prefix, hit.chip);
      if (comment.parentNode) comment.parentNode.removeChild(comment);
    } catch {
      // Fail closed: a skipped tally renders as plain text.
    }
  }

  // --- pass 2: literal markers inside text nodes ---
  const texts: Text[] = [];
  const textWalker = doc.createTreeWalker(root, 0x4 /* SHOW_TEXT */);
  let t = textWalker.nextNode();
  while (t) {
    if (t.nodeType === 3 && t.nodeValue) texts.push(t as Text);
    t = textWalker.nextNode();
  }

  for (const textNode of texts) {
    try {
      if (isSkipped(textNode)) continue;
      const value = textNode.nodeValue ?? '';
      const tokens = parseMarkedTallies(value, 0);
      if (tokens.length === 0) continue;
      const parent = textNode.parentNode;
      if (!parent) continue;
      let cursor = 0;
      const frag = doc.createDocumentFragment();
      for (const token of tokens) {
        if (token.from > cursor) {
          frag.appendChild(doc.createTextNode(value.slice(cursor, token.from)));
        }
        frag.appendChild(buildChip(token.count, resolved, showTotal));
        cursor = token.to;
      }
      if (cursor < value.length) frag.appendChild(doc.createTextNode(value.slice(cursor)));
      parent.replaceChild(frag, textNode);
    } catch {
      // Ignore: the original text stays.
    }
  }
}

/**
 * Register the reading-view renderer. Registered unconditionally — it renders
 * nothing when a note has no marked tallies, and reading view is where a
 * committed tally is actually *read*.
 */
export function registerReadingTallies(plugin: Plugin, showTotal = true): void {
  try {
    plugin.registerMarkdownPostProcessor((el) => {
      try {
        renderTalliesInElement(el, showTotal);
      } catch {
        // A post processor must never throw into Obsidian's render pipeline.
      }
    });
  } catch {
    // Older API without post processors: reading view keeps rendering raw text.
  }
}
