# Zheng Tally for Obsidian — V1 Design

Date: 2026-09-14
Status: Proposed for implementation
Scope: Obsidian desktop only

## 1. Goal

Build an Obsidian plugin that makes Chinese 正字 tally counting usable inside Markdown editing without relying on system-wide Unicode tally glyph support.

The plugin provides a temporary tally-input mode:
- `Alt+Z` enters tally mode.
- `Space` or mouse click increments the count.
- `Backspace` decrements the count.
- `Enter` commits the result into the editor.
- `Esc` cancels without changing the note.

The counting UI is rendered by the plugin itself, so the 1–5 stroke states do not depend on the active Obsidian font.

## 2. Scope

V1 supports:
- Obsidian desktop.
- Markdown editor / Live Preview editing surface.
- One active tally session at a time.
- Integer tally state.
- Plugin-rendered 正字 visualization.
- Stable text commit format.
- Experimental Unicode tally commit format.
- Keyboard interaction.
- Mouse click increment.

V1 does not support:
- System IME / TSF integration.
- Chrome or other applications.
- Mobile Obsidian.
- WeChat / QQ / Office compatibility.
- Global font installation or modification.
- Cloud sync.
- Multiple simultaneous counters.
- History / analytics.
- Rich-text image or SVG insertion.
- Automatic cross-app compatibility detection.

## 3. Core interaction

### Enter mode

Default command/hotkey:
`Alt+Z`

When invoked with an active editor:
1. Capture the current cursor position.
2. Start a tally session with `count = 0`.
3. Show a compact overlay near the cursor.
4. Capture tally-mode keystrokes until commit or cancel.

If no editable Markdown editor is active, the command exits without starting a session.

### Tally-mode controls

- `Space`: `count += 1`
- Mouse click on overlay: `count += 1`
- `Backspace`: `count = max(0, count - 1)`
- `Enter`: commit and close
- `Esc`: cancel and close

Other keys are ignored by the tally session and must not insert accidental editor content while the mode is active.

### Commit behavior

Default stable format:
- 0 → empty string
- 1 → `·1`
- 4 → `·4`
- 5 → `正`
- 8 → `正·3`
- 18 → `正正正·3`

General rule:
- quotient = `floor(count / 5)`
- remainder = `count % 5`
- output `正` repeated `quotient` times
- append `·N` only when `remainder > 0`

Experimental Unicode format:
- use the standardized tally-mark characters for 1–5 where available
- this mode is opt-in and is not the default because font support is unreliable

The internal state is always the integer `count`; rendered or committed glyphs are never the source of truth.

## 4. Rendering model

The overlay must be **font-adaptive**. It must not ship one fixed visual style for `正`.

### Font inheritance

At session start, the renderer reads the active editor's computed typography and follows it:
- `font-family`
- `font-size`
- `font-weight`
- `font-style`
- text color

The tally preview therefore changes with the note/editor environment. A Song/Ming-style editor should produce a Song/Ming-style tally; a Hei/sans editor should produce a Hei/sans tally; a Kai-style editor should follow that font when the environment exposes it.

Complete groups of five must render ordinary `正` using the editor's current font stack, not an embedded tally font.

### Partial states 1–4

V1 must avoid a fixed SVG glyph set.

The first implementation should use font-native glyph composition where possible:
- state 1: render `一` in the inherited editor font
- state 2: render `丁` in the inherited editor font
- state 3: render `下` in the inherited editor font
- state 4: derive the four-stroke appearance from a rendered `正` in the same inherited font by masking/removing only the final bottom stroke
- state 5: render ordinary `正`

This is grounded in documented historical/typographic similarity: the Unicode ideographic tally proposal explicitly lists `一`, `丁`, and `下` as similar or historically used forms for tally states 1–3, and `正` for state 5.

State 4 is the only stage without a normal CJK character equivalent. Its rendering is therefore a dedicated font-adaptive operation, not a bundled fixed glyph. The implementation may rasterize/render `正` offscreen and apply a normalized mask or equivalent technique, but the visible stroke shapes must originate from the active font.

If a font makes the state-4 transformation unreliable, the renderer may fall back to a clearly marked compatibility preview for that session rather than silently switching the whole tally to one bundled font.

### Preview independence from Unicode tally coverage

The preview must not require U+1D372–U+1D376 support. Those characters remain optional output only.

The overlay should show:
- tally visualization
- numeric count in small secondary text

Example for 18:
`正 正 正 [three-stroke partial in current editor font]   18`

## 5. Architecture

### `main.ts`
Responsibilities:
- plugin lifecycle
- command registration
- hotkey registration
- session creation/destruction
- settings loading

Must not contain tally rendering logic or counting rules.

### `tally-state.ts`
Pure state module.

Responsibilities:
- store count
- increment/decrement/reset
- derive quotient/remainder
- generate stable commit text
- generate experimental Unicode commit text

Must be independently unit-testable without Obsidian APIs.

### `renderer.ts`
Responsibilities:
- create overlay DOM
- read/inherit active editor computed typography
- render full `正` with the active font stack
- render partial states 1–3 through font-native CJK glyphs
- render state 4 through a font-adaptive transformation of `正`
- update numeric count
- expose click callback
- position UI near editor cursor

No editor mutation logic. No bundled single-style tally font is allowed as the normal rendering path.

### `editor-session.ts`
Responsibilities:
- bind active editor
- capture keyboard input
- track original cursor
- coordinate state + renderer
- insert committed text
- cancel cleanly
- dispose listeners reliably

Only one session may exist at a time.

### `settings.ts`
V1 settings:
- commit format: `stable` | `unicode`
- optional hotkey documentation only; actual hotkey remains registered through Obsidian command system

No additional customization in V1.

## 6. Data flow

`Alt+Z`
→ create `TallyState(0)`
→ create `TallyRenderer`
→ create `EditorSession`
→ user input mutates integer state
→ renderer re-renders from state
→ `Enter`
→ state generates commit text
→ editor session inserts text at captured/current insertion point
→ dispose overlay/listeners/session

Cancel path:
`Esc`
→ no editor mutation
→ dispose everything

## 7. Error handling

The plugin must fail closed.

Cases:
- no active editor → do nothing
- session already active → focus/reuse current session rather than create another
- overlay render failure → terminate session without modifying note
- editor loses focus / leaf changes → cancel session
- plugin unload → destroy active session and listeners
- commit insertion failure → close session and surface a small Obsidian notice

No partially committed fallback text should be inserted after an exception.

## 8. Cursor policy

V1 uses the cursor position active when tally mode starts.

If the user changes editor/leaf while tally mode is active:
- cancel the session

The user does not edit normal Markdown while the tally overlay is active.

This keeps V1 deterministic and avoids synchronization complexity.

## 9. Visual constraints

The overlay is functional, not a full design system.

Requirements:
- compact
- legible in light and dark Obsidian themes
- no dependency on a custom installed tally font
- inherit the active editor's Chinese font stack rather than impose one fixed typeface
- positioned close to cursor without covering the current line when possible
- partial strokes must visually read as one evolving 正 character
- no animation required in V1

## 10. Testing

### Unit tests
`tally-state.ts`:
- increment
- decrement floor at zero
- quotient/remainder
- stable serialization for 0, 1, 4, 5, 6, 18, 25
- Unicode serialization mapping

### Integration tests
- enter session
- Space increments
- Backspace decrements
- Enter inserts exactly once
- Esc inserts nothing
- switching leaf cancels
- second `Alt+Z` does not create duplicate session
- unload removes overlay/listeners
- renderer inherits editor font-family / font-size / font-weight
- switching between at least three representative Chinese font stacks changes the tally preview accordingly
- state 4 remains recognizable after font switching

### Manual acceptance
On Windows Obsidian desktop:
1. Open a Markdown note.
2. Press `Alt+Z`.
3. Press Space 18 times.
4. Preview shows three complete 正 plus a three-stroke partial state and numeric `18`.
5. Press Backspace once; preview becomes 17.
6. Press Space once; returns to 18.
7. Press Enter.
8. Editor receives `正正正·3`.
9. Repeat and press Esc; editor remains unchanged.

## 11. V1 success criteria

V1 is complete when:
- the full keyboard flow is stable
- tally rendering is independent of system tally-glyph Unicode coverage
- the tally preview follows the active editor's Chinese font rather than one bundled style
- stable commit output works in ordinary Markdown text
- session cleanup has no stuck keyboard capture or orphan overlay
- tests pass
- no V2 features are introduced

## 12. Deferred work

Possible later work, not part of V1:
- Chrome/system-wide input
- mobile
- native Windows IME
- richer commit/export formats
- clipboard dual-format payloads
- history
- multiple counters
- statistics
- custom stroke style
- animation
- capability detection for Unicode tally glyph support
