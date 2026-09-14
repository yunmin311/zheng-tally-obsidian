# Zheng Tally for Obsidian

Chinese 正字 tally counting in the Obsidian Markdown editor.

## Installation

### From release (recommended)
1. Download the latest `main.js` and `manifest.json` from [Releases](https://github.com/yunmin311/zheng-tally-obsidian/releases)
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

## Usage

1. Open a Markdown note in Obsidian desktop
2. Press `Alt+Z` to enter tally mode
3. Press `Space` or click the overlay to increment
4. Press `Backspace` to decrement
5. Press `Enter` to commit, `Esc` to cancel

### Default (stable) output format

| Count | Output |
|-------|--------|
| 0 | *(empty)* |
| 1 | `·1` |
| 4 | `·4` |
| 5 | `正` |
| 6 | `正·1` |
| 8 | `正·3` |
| 18 | `正正正·3` |
| 25 | `正正正正正` |

General rule: `floor(count/5)` copies of `正`, plus `·N` for remainder when `count % 5 > 0`.

### Experimental Unicode output format

Enable in plugin settings (`commitFormat: "unicode"`). Uses Unicode Ideographic Tally Marks U+1D372–U+1D376:

| Count | Output |
|-------|--------|
| 1 | `𝍲` |
| 2 | `𝍳` |
| 3 | `𝍴` |
| 4 | `𝍵` |
| 5 | `𝍶` |
| 6 | `𝍶𝍲` |
| 18 | `𝍶𝍶𝍶𝍴` |

> **Warning**: Font support for these glyphs is unreliable. This mode is opt-in only.

## Font adaptation

The tally preview inherits the editor's computed typography:
- `font-family`
- `font-size`
- `font-weight`
- `font-style`
- `color`

Complete groups of five always render as ordinary `正` using the editor's font stack.

Partial states 1–3 use font-native CJK glyphs:
- 1 stroke: `一`
- 2 strokes: `丁`
- 3 strokes: `下`

State 4 (four strokes) is derived by rasterizing `正` in the current font and masking the bottom stroke. If this fails for a particular font, it falls back to a visible `[4]` indicator rather than silently switching to a bundled font.

The preview never depends on U+1D372–U+1D376 font coverage.

## V1 limitations

- **Obsidian Desktop only** — no mobile, no Chrome, no system-wide IME
- **Single counter** — one active tally session at a time
- **No history/analytics** — each session is independent
- **No animation** — instant state updates only
- **Cursor policy** — uses cursor position at session start; switching leaves cancels the session
- **Fail closed** — exceptions never leave partial text or orphan listeners

## Development

```bash
npm install       # install dependencies
npm run dev       # watch mode build
npm run build     # production build
npm test          # run tests
npm run lint      # eslint
npm run typecheck # tsc --noEmit
```

## Architecture

- `tally-state.ts` — pure integer state, serialization (unit tested)
- `renderer.ts` — font-adaptive overlay DOM, canvas-based state-4 derivation
- `editor-session.ts` — keyboard capture, lifecycle, commit/cancel
- `settings.ts` — commit format preference
- `main.ts` — plugin entry, command registration

## License

MIT