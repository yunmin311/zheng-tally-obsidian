# Changelog

## 1.0.5

- **Fixed for real: committed tallies in reading view.** 1.0.3 and 1.0.4 both
  failed on this, and both failed for the same reason — they were looking for
  something the reading view had already thrown away.
  - **The root cause.** Reading view passes its HTML through a bundled
    DOMPurify that carries no `ALLOW_COMMENTS` option, so **every HTML comment
    is stripped** before any Markdown post processor runs. By the time this
    plugin sees the DOM, `<!--zt:12-->` is gone and only the visible half
    (`·2`) is left. The earlier passes scanned for a comment node, and then for
    a literal marker inside a text node; in reading view neither can ever
    exist. That is also why editing mode was always fine: CodeMirror
    decorations read the *document string*, where the marker is intact.
  - **The count cannot be recovered from the visible half.** `·2` means
    "0 full strokes + 2" — it is not a number, and `正正·1` and `正正·1` are
    indistinguishable in the DOM even when they hold different counts.
  - **The fix.** The block's **original Markdown source** is read back through
    `ctx.getSectionInfo(el).text`, which predates the sanitizer and still holds
    the markers. Markers are parsed out of the source and paired to the DOM
    text nodes that render their visible halves, using the surrounding source
    text as context so two tallies with an identical visible half get their own
    counts. Pairing falls back to front-to-back order when the context does not
    line up, and the ownership check still fails closed — an unverifiable
    tally stays plain text rather than rendering a wrong number.
  - The two previous passes are retained as harmless no-ops for hosts that do
    preserve comments or literal markers.
- 10 new tests (168 total), including the reported `homepage.md` case and a
  duplicate-visible-half case.

## 1.0.4

- **Fixed: some committed tallies still did not render in reading view.**
  1.0.3 shipped the post processor, but two cases slipped through:
  - **A trailing space before the marker.** The tail matcher was anchored with
    `$` and did not tolerate whitespace, so a soft line break rendered as a
    trailing space and the tally was rejected. The matcher now allows trailing
    whitespace (`\s*`) — the author did not mean anything by it.
  - **An inline `<code>` elsewhere in the same paragraph.** The skip check
    walked *all* ancestors, so an unrelated code span in a sibling branch
    vetoed the tally. The check now stops at the parent that contains the
    marker's sibling, which is the only container the two actually share.
    A tally that genuinely lives inside `<code>` or `<pre>` is still skipped.
- Both cases are covered by regression tests.

## 1.0.3

- **Committed tallies now render in reading view.** Every other renderer in
  the plugin works through CodeMirror decorations, which never reach Obsidian's
  MarkdownRenderer — so in reading view a committed tally fell through as its
  raw visible half (a stray `·3`, with the `<!--zt:N-->` marker invisible
  because it is an HTML comment). A `registerMarkdownPostProcessor` pass now
  renders the same vector chip there, reusing the existing parser, ownership
  check and chip builder.
  - Only marker-owned tallies are chipped: the marker must re-serialize to
    exactly the visible text, otherwise nothing is rendered (fail closed).
    Legacy bare `正正正·3` text is left untouched, as in the editor.
  - Reading-view chips are read-only (`data-reading="true"`); counting stays an
    editor action. Code blocks and already-rendered chips are skipped, so a
    repeated post-processor pass cannot nest chips.
- New module `src/reading-tally.ts`, 11 new tests (155 total).

## 1.0.2

Community-directory review fixes — no change to tally behavior, persistence,
rendering, or the keyboard controls themselves.

- Manifest description no longer contains the word "Obsidian" (the directory
  treats it as redundant, since the context already implies it)
- Styling moved out of per-element style assignments into `styles.css`
  (`.zt-total`, `.zt-total--hidden`, `.zt-count-badge-popup`), as required by
  `obsidianmd/no-static-styles-assignment`. Values are CSS-driven now, so the
  chip also became themeable. Chip typography still follows the host editor
  because it is read at render time
- `document.createElement` replaced with Obsidian's `createEl`/`createDiv`
  helpers, which resolve against the correct window in pop-out windows
- `window.setTimeout` / `window.clearTimeout` used for the same reason
- Command renamed `Start Zheng Tally counting` → `Start counting`, since
  Obsidian already shows the plugin name beside the command
- The default `Alt+Z` hotkey is **kept on purpose**. The review lists it as a
  Warning (a possible conflict), not an Error, and shipping with no way to start
  a tally is worse than the warning — `Alt+Z` clashes with no Obsidian default,
  and it can be rebound under Settings → Hotkeys

## 1.0.1

- Obsidian Community Directory submission compliance
- Normalized command ID (`zheng-tally:start` → `start`); default `Alt+Z` hotkey unchanged
- Directory-safe manifest description
- No changes to tally behavior, persistence, rendering, or keyboard controls

## 1.0.0

- Canonical progressive `正` tally: the same 5-stroke vector at every count,
  states 1–5, no font-glyph substitution
- True CodeMirror 6 inline widget — the counter lives inside the text flow
- Keyboard controls: `Alt+Z` start, `Space`/`+` count up, `Backspace`/`-`
  count down, `Enter` commits, `Esc` cancels with zero writes
- Stable Markdown commit with marker-backed integer SOT
  (`正正正·3<!--zt:18-->` for 18); visible text stays readable without the plugin
- V1 persistence uses the marker-backed stable format as the canonical storage
  representation (the experimental Unicode commit option is retired; a stored
  `unicode` preference migrates safely to stable, old Unicode text untouched)
- Persistent resumable tally objects: vector chips survive note reopens,
  plugin reloads, and Obsidian restarts; click or caret + `Alt+Z` resumes
- Compact large-count preview that never drops the in-progress group
  (up to 4 slots full, then leading fulls + most-recent full + partial)
- Hover/caret count badge for legacy tallies: transient anchored overlay,
  conservative boundary detection, no layout shift, no document edits
- Font-aware sizing and baseline via a hidden native `正` measurement;
  strokes follow `currentColor` across themes
- Single active session, fail-closed lifecycle, desktop-only
