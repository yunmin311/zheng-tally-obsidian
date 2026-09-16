# Zheng Tally for Obsidian

Chinese 正-character tally counting in the Obsidian Markdown editor (desktop).

Press `Alt+Z`, tap `Space` to count, `Enter` to commit a stable `正正正·3`-style
tally into your note. The live preview renders the same canonical 5-stroke
`正` vector at every step — never a different character, never a scaled font glyph.

## Features

- True CodeMirror 6 inline widget — the counter sits inside the text flow
- Canonical 5-stroke `正` vector preview, progressive 1 → 5
- Font-aware sizing and baseline via a hidden native `正` measurement
- Stable Markdown commit (`正正正·3`), large-count compact preview (`正正…正 83`)
- Hover/caret count badge for committed tallies (conservative detection)
- Fail-closed sessions: `Esc` writes nothing, exceptions leave no residue

## Screenshots

All screenshots below are captured from real Obsidian smoke runs.

Progressive strokes 1–5 (same canonical vector, per-state path counts):

![Progressive tally states 1 to 5](docs/images/progressive-1-5.png)

Inline counting between Chinese text (size/baseline match the surroundings):

![Inline counting](docs/images/inline-counting.png)

Large-count compact preview with exact total on the right:

![Large-count compact preview](docs/images/large-count.png)

Committed-tally hover badge (no layout shift, no document edit):

![Hover count badge](docs/images/count-badge.png)

## Installation

### From release (recommended)

1. Download `main.js` and `manifest.json` from
   [Releases](https://github.com/yunmin311/zheng-tally-obsidian/releases)
2. Place them in `<vault>/.obsidian/plugins/zheng-tally/`
3. Enable the plugin in Settings → Community plugins

### From source

```bash
git clone https://github.com/yunmin311/zheng-tally-obsidian.git
cd zheng-tally-obsidian
npm install
npm run build
```

Copy `dist/main.js` and `dist/manifest.json` to your vault's plugin folder.
No `styles.css` is needed (the plugin ships none).

## Usage

1. Open a Markdown note in Obsidian desktop
2. Press `Alt+Z` (`Start Zheng Tally counting`) to enter tally mode
3. Press `Space` (or `+`) to count up, `Backspace` (or `-`) to count down
4. Press `Enter` to commit, `Esc` to cancel without writing anything

Only one tally session is active at a time. Switching leaves ends the session
without writing.

## Keyboard controls

| Key | Action |
|-----|--------|
| `Alt+Z` | Start tally session |
| `Space` / `+` / `NumpadAdd` / `Shift+=` | +1 |
| `Backspace` / `-` / `_` / `NumpadSubtract` | −1 (floors at 0) |
| `Enter` | Commit stable Markdown, single edit |
| `Esc` | Cancel, zero document changes |

`Ctrl`/`Alt`/`Meta` combinations pass through and keep the session alive.

## Stable Markdown format

`Enter` writes plain text only — the trailing live total is never written:

| Count | Committed text |
|-------|----------------|
| 0 | *(nothing — `Esc` instead)* |
| 1 | `·1` |
| 4 | `·4` |
| 5 | `正` |
| 6 | `正·1` |
| 8 | `正·3` |
| 18 | `正正正·3` |
| 25 | `正正正正正` |

General rule: `floor(count/5)` copies of `正`, plus `·N` for a non-zero remainder.
An optional Unicode tally-marks format (`commitFormat: "unicode"`) exists in
settings, but font coverage for U+1D372–U+1D376 is unreliable, so it stays opt-in.

## Large-count compact preview

Up to 15, every tally group is shown. Above 15 the preview compacts so the
editor never fills with a wall of `正`:

```text
正 正 … [partial] 83
```

The right-hand total (`zt-total`, `0.75em`, dimmed, tabular numerals) is always
the exact live count. `Enter` still commits the full stable form
(e.g. 18 → `正正正·3`).

## Hover/caret count badge

Moving the mouse over, or placing the caret inside, a committed tally token
shows its numeric count (e.g. `正正正·3` → `18`). The badge is a transient
anchored overlay: it is hidden by default, never edits the Markdown, adds no
metadata, and never shifts surrounding text.

Detection is deliberately conservative (heuristic): a token only counts at a
hard boundary (document start/end, whitespace, punctuation, symbols). Matches
inside ordinary Han/Latin/digit runs never badge — `正正好`, `正正方方`,
`测试正正内容` and `第·3项` stay silent. A lone `正` (count 5) is never badged
either, since it is indistinguishable from ordinary Chinese prose. This is an
explicit design limitation, not something heuristics should override.

## Canonical 5-stroke vector architecture

The preview is built from one vendored 5-stroke vector source for `正`
(Hanzi Writer Data, derived from Make Me a Hanzi / Arphic fonts — see
[License](#license)). Canonical stroke order 横 / 竖 / 横 / 竖 / 横 is preserved;
state *N* renders exactly the first *N* paths. No rasterization, no canvas
masks, no per-font stroke guessing, no network requests at runtime.

## Typography / native sizing

Each tally glyph pairs two layers in the same grid cell:

- a hidden native `正` span — the **only** sizing element, providing the real
  advance width, line box and baseline from the current editor font
  (family/size/weight/style/color are inherited);
- the canonical SVG stroke overlay, which fills that cell with its own
  intrinsic sizing suppressed (`contain: size`, zero minimums), so the
  default 300×150 SVG box can never decide the layout.

Strokes use `fill="currentColor"`, so light/dark themes recolor for free.

## Limitations

- **Obsidian desktop only** — no mobile support
- **Single counter** — one active tally session at a time
- **No history or statistics** — each session is independent
- **Conservative badge** — lone `正` and in-word matches never badge (by design)
- Switching leaves cancels the session without writing

## Development

```bash
npm install       # install dependencies
npm run dev       # watch mode build
npm run build     # production build (dist/main.js + dist/manifest.json)
npm test          # run tests (99 passing)
npm run lint      # eslint
npm run typecheck # tsc --noEmit
```

## Architecture

- `src/zheng-strokes.ts` — canonical 5-stroke vectors for `正` (Arphic data, not MIT)
- `src/renderer.ts` — native-sized vector glyph + tally chip DOM
- `src/cm6-widget.ts` — true CM6 inline `Decoration.widget`
- `src/editor-host.ts` — single sanctioned CodeMirror access point
- `src/editor-session.ts` — keyboard capture, lifecycle, commit/cancel
- `src/tally-hover.ts` — committed-token parser + transient count badge
- `src/tally-state.ts` — pure integer state, serialization
- `src/settings.ts` — commit format preference
- `src/main.ts` — plugin entry, command registration
- `vendor/` — Arphic Public License + attribution notes

## License

- **Plugin source code: MIT** — see [LICENSE](LICENSE).
- **Canonical `正` stroke vector data: Arphic Public License, NOT MIT** —
  source Hanzi Writer Data / Make Me a Hanzi, extracted from Arphic Technology
  fonts. Full data license: [vendor/ARPHICPL.txt](vendor/ARPHICPL.txt),
  attribution notes: [vendor/README.md](vendor/README.md).
