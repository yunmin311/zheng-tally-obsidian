# Changelog

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
- Removed the bundled default `Alt+Z` hotkey: the directory flags default
  hotkeys as a conflict risk. Assign it once under Settings → Hotkeys
  (search "Zheng Tally") — see the README
- Command renamed `Start Zheng Tally counting` → `Start counting`, since
  Obsidian already shows the plugin name beside the command

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
