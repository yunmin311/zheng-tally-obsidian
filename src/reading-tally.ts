import type { Plugin } from 'obsidian';
import { buildTallyChip, readHostTypography, type ZhengTypography } from './renderer';
import { parseMarkedTallies, stableTextForCount } from './tally-state';
import { alignedReadingHits, isReadingAlignmentDelimiter } from './reading-source';

/**
 * Reading-view rendering for committed tallies.
 *
 * Why this file exists: everything else in the plugin renders through
 * CodeMirror decorations, which only exist in the editor. Reading view goes
 * through Obsidian's MarkdownRenderer, so a committed tally (`正正·3<!--zt:12-->`)
 * used to fall through as raw text.
 *
 * ============================================================================
 * ⚠️ WHY THE OBVIOUS APPROACHES DO NOT WORK
 * ============================================================================
 *
 * Reading view sanitizes its HTML with DOMPurify (bundled inside Obsidian).
 * The build Obsidian ships has **no `ALLOW_COMMENTS` option at all** and strips
 * every HTML comment unconditionally. Consequence: by the time a Markdown post
 * processor runs, `<!--zt:12-->` is *gone from the DOM*. Only the visible half
 * (`·3`) survives.
 *
 * That kills both DOM-based strategies:
 *   - scanning for comment nodes      → there are none
 *   - scanning text for the literal   → the literal includes the comment
 *
 * And it is why the editor works while reading view does not: CodeMirror
 * decorations read the *document string*, where the marker is intact.
 *
 * The only surviving source of the count is therefore the **original Markdown
 * source**, which Obsidian exposes through `ctx.getSectionInfo(el)`.
 * Its `text` is the whole document, so first limit it with lineStart/lineEnd.
 * Then align complete rendered section text with source marker positions.
 *
 * Visible tally text alone does not prove plugin ownership: an ordinary 正
 * must never become a tally because a different source occurrence is marked.
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

/** Visible half of a marked tally, anchored at the end of a text node.
 *  Trailing whitespace is tolerated: a soft line break before the marker
 *  renders as a space (or newline, depending on the parser) in the DOM, and
 *  that is not the author saying anything about the tally. */
const VISIBLE_TAIL_RE = /(正+(?:·[1-4])?|·[1-4])\s*$/;

/** Marker as it survives the HTML parse: `<!--zt:12-->` becomes `zt:12`.
 *  Kept for the (increasingly rare) hosts that do preserve comments. */
const COMMENT_MARKER_RE = /zt:(\d+)/;

/**
 * Containers where a tally is source text, not a tally: code, LaTeX output,
 * and anything the plugin already rendered (post processors can run again on
 * the same subtree, and re-chipping a chip would nest them).
 */
const SKIP_TAGS = new Set(['PRE', 'CODE', 'SCRIPT', 'STYLE', 'TEXTAREA']);

/**
 * Is `node` inside a container that must not be re-rendered?
 *
 * Two different questions depending on what we are about to touch, so the
 * caller says which one it means:
 *
 * - `'text'` (default): we are rewriting `node` itself, so *any* skipped
 *   ancestor disqualifies it.
 * - `'sibling'`: `node` is a marker comment and the text we rewrite is its
 *   **previous sibling**. Walking up past the shared parent then asks the
 *   wrong question — a stray inline `<code>` elsewhere in the paragraph would
 *   veto a tally that lives outside it. We therefore only test the ancestors
 *   of the comment up to (and excluding) the element that also contains the
 *   sibling, i.e. we stop as soon as the sibling would be included.
 */
function isSkipped(node: Node | null, scope: 'text' | 'sibling' = 'text'): boolean {
  let cur: Node | null = node;
  while (cur) {
    if (cur.nodeType === 1) {
      const el = cur as HTMLElement;
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.classList && el.classList.contains('zheng-tally-inline')) return true;
      // `sibling` scope: once we reach an element that has more than this one
      // child, the sibling no longer shares the container's fate — stop here.
      if (scope === 'sibling' && cur.childNodes.length > 1) return false;
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

/** All text nodes under `root`, in document order. */
function collectTextNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, 0x4 /* SHOW_TEXT */);
  let cur = walker.nextNode();
  while (cur) {
    if (cur.nodeType === 3 && cur.nodeValue) out.push(cur as Text);
    cur = walker.nextNode();
  }
  return out;
}

/**
 * Pass 0 — the one that actually matters in reading view.
 *
 * Parses markers out of the block's **original Markdown source** and pairs
 * them with the DOM text node rendering each visible half. This is the only
 * pass that survives Obsidian's comment stripping; see the file header.
 */
function renderFromSource(
  root: HTMLElement,
  sectionText: string,
  typo: ZhengTypography,
  showTotal: boolean,
  exactSection: boolean,
): void {
  if (root.querySelector('.zheng-tally-inline')) return;
  const nodes = collectTextNodes(root);
  const positions: { node: Text; offset: number }[] = [];
  let text = '';
  for (const node of nodes) {
    const value = node.nodeValue ?? '';
    for (let offset = 0; offset < value.length; offset++) {
      if (isReadingAlignmentDelimiter(value[offset])) continue;
      positions.push({ node, offset });
      text += value[offset];
    }
  }
  const edits = new Map<Text, { from: number; to: number; count: number }[]>();
  for (const hit of alignedReadingHits(sectionText, text, exactSection)) {
    const first = positions[hit.from], last = positions[hit.to - 1];
    if (!first || !last || first.node !== last.node || isSkipped(first.node)) continue;
    if (first.node.nodeValue?.slice(first.offset, last.offset + 1) !== stableTextForCount(hit.count)) continue;
    const bucket = edits.get(first.node) ?? [];
    bucket.push({ from: first.offset, to: last.offset + 1, count: hit.count });
    edits.set(first.node, bucket);
  }
  const doc = root.ownerDocument ?? document;
  for (const [node, hits] of edits) {
    const value = node.nodeValue ?? '', frag = doc.createDocumentFragment();
    let cursor = 0;
    for (const hit of hits) {
      frag.appendChild(doc.createTextNode(value.slice(cursor, hit.from)));
      frag.appendChild(buildChip(hit.count, typo, showTotal));
      cursor = hit.to;
    }
    frag.appendChild(doc.createTextNode(value.slice(cursor)));
    node.parentNode?.replaceChild(frag, node);
  }
}

/**
 * Pass 1 — comment nodes. Only fires on hosts that keep HTML comments; kept
 * because it is the cheapest and most direct signal when it is available.
 */
function renderFromComments(
  root: HTMLElement,
  typo: ZhengTypography,
  showTotal: boolean,
): void {
  const doc = root.ownerDocument ?? document;
  const comments: Comment[] = [];
  const walker = doc.createTreeWalker(root, 0x80 /* SHOW_COMMENT */);
  let cur = walker.nextNode();
  while (cur) {
    if (cur.nodeType === 8) comments.push(cur as Comment);
    cur = walker.nextNode();
  }

  for (const comment of comments) {
    try {
      if (isSkipped(comment, 'sibling')) continue;
      const m = COMMENT_MARKER_RE.exec(comment.nodeValue ?? '');
      if (!m) continue;
      const count = Number(m[1]);
      if (!Number.isSafeInteger(count) || count <= 0) continue;
      const prev = comment.previousSibling;
      if (!prev || prev.nodeType !== 3 || !prev.nodeValue) continue;
      if (isSkipped(prev, 'sibling')) continue;
      const hit = chipFromTail(prev.nodeValue, count, typo, showTotal);
      if (!hit) continue;
      const parent = prev.parentNode;
      if (!parent) continue;
      swapIn(parent, prev, hit.prefix, hit.chip);
      if (comment.parentNode) comment.parentNode.removeChild(comment);
    } catch {
      // Fail closed.
    }
  }
}

/**
 * Pass 2 — literal markers inside a single text node. Happens when raw HTML is
 * escaped rather than parsed, e.g. inside some embeds. Same parser the editor
 * uses, so the ownership check is identical.
 */
function renderFromLiterals(
  root: HTMLElement,
  typo: ZhengTypography,
  showTotal: boolean,
): void {
  const doc = root.ownerDocument ?? document;
  for (const textNode of collectTextNodes(root)) {
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
        frag.appendChild(buildChip(token.count, typo, showTotal));
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
 * Main entry. `sectionText` is the block's original Markdown, when the caller
 * can supply it (`ctx.getSectionInfo(el)?.text`). It is what makes reading view
 * work at all — see the file header.
 *
 * Order of the passes is deliberate: the source pass is authoritative because
 * the sanitizer has already destroyed the in-DOM markers, so it runs first and
 * consumes the markers it binds. The other two only ever fire on hosts where
 * the markers survived, and are harmless no-ops otherwise.
 */
export function renderTalliesInElement(
  root: HTMLElement,
  showTotal = true,
  sectionText?: string | null,
  exactSection = false,
): void {
  let typo: ZhengTypography | null = null;
  try {
    typo = readHostTypography(root);
  } catch {
    typo = null;
  }
  const resolved = typo ?? FALLBACK_TYPOGRAPHY;

  if (sectionText) {
    try {
      renderFromSource(root, sectionText, resolved, showTotal, exactSection);
    } catch {
      // Fail closed.
    }
  }
  renderFromComments(root, resolved, showTotal);
  renderFromLiterals(root, resolved, showTotal);
}

/**
 * Register the reading-view renderer.
 *
 * `getSectionInfo` is called defensively: it returns null for elements the
 * renderer does not own (nested embeds, hover previews) and the API has been
 * present since long before this plugin's `minAppVersion`, but a missing
 * implementation must degrade to the DOM-only passes rather than break the
 * render pipeline.
 */
export function registerReadingTallies(plugin: Plugin, showTotal = true): void {
  try {
    plugin.registerMarkdownPostProcessor((el, ctx) => {
      try {
        let sectionText: string | null = null;
        try {
          const info = ctx?.getSectionInfo?.(el);
          if (info && typeof info.text === 'string' && Number.isInteger(info.lineStart)
              && Number.isInteger(info.lineEnd) && info.lineStart >= 0 && info.lineEnd >= info.lineStart) {
            const lines = info.text.split(/\r?\n/);
            if (info.lineEnd < lines.length) sectionText = lines.slice(info.lineStart, info.lineEnd + 1).join('\n');
          }
        } catch {
          sectionText = null;
        }
        renderTalliesInElement(el, showTotal, sectionText, true);
      } catch {
        // A post processor must never throw into Obsidian's render pipeline.
      }
    });
  } catch {
    // Older API without post processors: reading view keeps rendering raw text.
  }
}
