# Changelog

## 1.0.0

- Canonical progressive `正` tally: the same 5-stroke vector at every count,
  states 1–5, no font-glyph substitution
- True CodeMirror 6 inline widget — the counter lives inside the text flow
- Keyboard controls: `Alt+Z` start, `Space`/`+` count up, `Backspace`/`-`
  count down, `Enter` commits, `Esc` cancels with zero writes
- Stable Markdown commit (`正正正·3` for 18); the live total is never written
- Compact large-count preview above 15 (`正正…正 83`) with exact live total
- Hover/caret count badge for committed tallies: transient anchored overlay,
  conservative boundary detection, no layout shift, no document edits
- Font-aware sizing and baseline via a hidden native `正` measurement;
  strokes follow `currentColor` across themes
- Single active session, fail-closed lifecycle, desktop-only
