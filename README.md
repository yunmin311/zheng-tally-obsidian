# Zheng Tally

> A native-feeling 正 tally counter for Obsidian.
> Count stroke by stroke, keep it inline, and resume anytime.

[![Release](https://img.shields.io/github/v/release/yunmin311/zheng-tally-obsidian)](https://github.com/yunmin311/zheng-tally-obsidian/releases)
[![CI](https://github.com/yunmin311/zheng-tally-obsidian/actions/workflows/ci.yml/badge.svg)](https://github.com/yunmin311/zheng-tally-obsidian/actions/workflows/ci.yml)
![Obsidian desktop](https://img.shields.io/badge/Obsidian-desktop-7f6df2)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

![Zheng Tally demo](docs/images/zheng-tally-demo.gif)

Press `Alt+Z`, tap `Space` to count, `Enter` to commit. The tally renders as a
real inline `正` built from canonical stroke vectors, and it stays that way:
committed tallies remain vector chips you can click to resume.

## Why Zheng Tally

Counting with 正 tallies in Markdown usually means typing characters by hand
and losing count halfway. Zheng Tally turns it into a tight loop: start
anywhere in a note, watch each stroke appear, commit a portable plain-text
tally, and pick it back up later without retyping. The editor shows vectors;
the file stays readable text.

## How it works

1. `Alt+Z` drops an inline counter at the cursor.
2. Each `Space` adds one canonical stroke (`一` → … → `正`), grouped in fives.
3. `Enter` writes `正正正·3<!--zt:18-->` — visible text plus a count marker.
4. The note keeps showing a vector chip, derived from that text on every load.
5. Click the chip (or caret + `Alt+Z`) to resume from 18. `Esc` never writes.

## Features

- Canonical 5-stroke `正` vectors at every step — never a substituted character
- True inline widget with font-matched size and baseline
- Persistent, resumable tally objects with restart-safe recovery
- Readable storage: notes stay meaningful with the plugin off
- Compact large-count preview that never drops the in-progress group
- Conservative hover/count badge for legacy tallies, zero layout shift

## Installation

From a release:

1. Download `main.js` and `manifest.json` from
   [Releases](https://github.com/yunmin311/zheng-tally-obsidian/releases).
2. Place both in `<vault>/.obsidian/plugins/zheng-tally/`.
3. Enable the plugin under Settings → Community plugins.

From source:

```bash
git clone https://github.com/yunmin311/zheng-tally-obsidian.git
cd zheng-tally-obsidian
npm install
npm run build
```

Copy `dist/main.js`, `manifest.json`, and `styles.css` into your vault's
plugin folder. (`styles.css` carries the chip and hover-badge styling.)

## Usage

1. Open a Markdown note (Obsidian desktop).
2. `Alt+Z` to start tally mode at the cursor.
3. `Space` / `+` to count up, `Backspace` / `-` to count down.
4. `Enter` to commit a persistent vector chip.
5. Click the chip (or caret + `Alt+Z`) to resume; `Esc` cancels cleanly.

One session at a time; switching leaves ends it without writing.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Alt+Z` | Start, or resume the tally under the caret |
| `Space` / `+` / `NumpadAdd` / `Shift+=` | +1 |
| `Backspace` / `-` / `_` / `NumpadSubtract` | −1 (floors at 0) |
| `Enter` | Commit (single edit) |
| `Esc` | Cancel, zero document changes |

`Ctrl`/`Alt`/`Meta` chords pass through untouched.

## Persistent & resumable tallies

Committed tallies keep rendering as vector chips — same strokes, same metrics,
quieter chrome — across note reopens, plugin reloads, and restarts, derived
purely from the note text.

- **Resume** from the stored total (18 → 19), never from zero.
- **Resume + `Enter`** rewrites text + marker in one edit
  (`正正正正·3<!--zt:23-->`).
- **Resume + `Esc`** changes nothing; the original chip returns.
- **Resume to 0 + `Enter`** removes the tally and its marker.
- **Ambiguous caret** between two adjacent tallies resumes neither.
- The persisted total stays hidden until hover or caret reaches the chip,
  reserving its space so nothing shifts.

![Persisted tally](docs/images/persisted-tally.png)

![Resumed tally](docs/images/resumed-tally.png)

## Storage format

| Count | Stored |
|-------|--------|
| 1 | `·1<!--zt:1-->` |
| 5 | `正<!--zt:5-->` |
| 18 | `正正正·3<!--zt:18-->` |

The `<!--zt:N-->` comment is the integer source of truth and ownership marker.
A marker counts only when it re-serializes to exactly the visible text;
mismatches fail closed. Unmarked legacy tallies (`正正正·3`) still get a
conservative hover badge and can be resumed once, upgrading on next `Enter`.
A lone `正` never auto-resumes.

## Large-count behavior

Up to four group slots render in full; beyond that the preview compacts while
always keeping the most-recent finished group and the live partial slot:

```text
18 -> 正 正 正 [state3]
20 -> 正 正 正 正
21 -> 正 正 … 正 [state1]
83 -> 正 正 … 正 [state3]
```

The right-hand total is always exact. Active and persisted chips share one
grouping algorithm, so committing never jumps visually.

![Progressive strokes](docs/images/progressive-1-5.png)

![Large count](docs/images/large-count.png)

## Architecture

- `src/zheng-strokes.ts` — vendored canonical 5-stroke vectors (Arphic data)
- `src/renderer.ts` — native-measured glyph cells + tally chips
- `src/cm6-widget.ts` — live inline `Decoration.widget`
- `src/persistent-tally.ts` — marker replace decorations + resume lookup
- `src/editor-session.ts` — keyboard capture, lifecycle, single-edit commits
- `src/tally-hover.ts` — legacy parser + transient count badge
- `src/tally-state.ts` — counts plus stable/marked serialization
- `src/editor-host.ts` — the single CodeMirror access point

## Compatibility / limitations

- Obsidian desktop only; no mobile support.
- One active session at a time; no history or statistics.
- Detection stays conservative by design: in-word matches and lone `正`
  never badge or resume.

## Development

```bash
npm install       # install dependencies
npm run dev       # watch mode build
npm run build     # production build (dist/main.js + dist/manifest.json)
npm test          # 143 passing
npm run lint      # eslint
npm run typecheck # tsc --noEmit
```

## License & data attribution

- Plugin source code: **MIT** — see [LICENSE](LICENSE).
- Canonical `正` stroke vectors: **Arphic Public License, not MIT** —
  via Hanzi Writer Data / Make Me a Hanzi, extracted from Arphic Technology
  fonts. Full text: [vendor/ARPHICPL.txt](vendor/ARPHICPL.txt), notes:
  [vendor/README.md](vendor/README.md).
