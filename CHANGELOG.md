# Changelog

## 1.0.0

- Canonical progressive `正` tally: the same 5-stroke vector at every count,
  states 1–5, no font-glyph substitution
- True CodeMirror 6 inline widget — the counter lives inside the text flow
- Keyboard controls: `Alt+Z` start, `Space`/`+` count up, `Backspace`/`-`
  count down, `Enter` commits, `Esc` cancels with zero writes
- Stable Markdown commit with marker-backed integer SOT
  (`正正正·3<!--zt:18-->` for 18); visible text stays readable without the plugin
- Persistent resumable tally objects: vector chips survive note reopens,
  plugin reloads, and Obsidian restarts; click or caret + `Alt+Z` resumes
- Compact large-count preview that never drops the in-progress group
  (up to 4 slots full, then leading fulls + most-recent full + partial)
- Hover/caret count badge for legacy tallies: transient anchored overlay,
  conservative boundary detection, no layout shift, no document edits
- Font-aware sizing and baseline via a hidden native `正` measurement;
  strokes follow `currentColor` across themes
- Single active session, fail-closed lifecycle, desktop-only
