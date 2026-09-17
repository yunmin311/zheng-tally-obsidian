# Zheng Tally for Obsidian V1 — Implementation Plan

Date: 2026-09-14
Based on: `docs/superpowers/specs/2026-09-14-zheng-tally-obsidian-design.md`

---

## Phase 0: Project Setup

1. Create `package.json` with:
   - TypeScript, @types/node
   - obsidian (peer dependency)
   - jest + ts-jest for testing
   - eslint + @typescript-eslint for linting
   - esbuild for build
2. Create `tsconfig.json` targeting ES2022, moduleResolution node
3. Create `manifest.json` with plugin metadata
4. Create `.eslintrc.json`, `jest.config.js`, `esbuild.config.mjs`
5. Create directory structure: `src/{main.ts,tally-state.ts,renderer.ts,editor-session.ts,settings.ts}`

---

## Phase 1: Core State Module (`tally-state.ts`)

**TDD**: Write failing tests first, then implement.

### Interface

```typescript
export interface TallyState {
  count: number;
  increment(): void;
  decrement(): void;
  reset(): void;
  quotient(): number;      // floor(count / 5)
  remainder(): number;     // count % 5
  toStableText(): string;  // e.g., 18 → "正正正·3"
  toUnicodeText(): string; // experimental Unicode tally glyphs
}
```

### Unit Tests (tally-state.test.ts)

| Input | quotient | remainder | Stable | Unicode |
|-------|----------|-----------|--------|---------|
| 0     | 0        | 0         | ""     | ""      |
| 1     | 0        | 1         | "·1"   | "𝍡"     |
| 4     | 0        | 4         | "·4"   | "𝍤"     |
| 5     | 1        | 0         | "正"   | "𝍥"     |
| 6     | 1        | 1         | "正·1" | "𝍥𝍡"    |
| 18    | 3        | 3         | "正正正·3" | "𝍥𝍥𝍥𝍤" |
| 25    | 5        | 0         | "正正正正正" | "𝍥×5" |

---

## Phase 2: Renderer (`renderer.ts`)

### Responsibilities

- Create overlay DOM element
- Read computed styles from active editor (`font-family`, `font-size`, `font-weight`, `font-style`, `color`)
- Render complete `正` groups using inherited font
- Render partial states 1–3 using font-native glyphs: `一` `丁` `下`
- Render state 4 via font-adaptive derivation from rendered `正`
- Update numeric count display
- Position near cursor
- Expose click handler for increment

### State 4 Strategy (MVP)

1. Offscreen canvas: render `正` at target font size
2. Determine bottom-stroke bounding box heuristically (lower ~20% of glyph height)
3. Mask/clear that region
4. Use resulting image as state-4 preview
5. If canvas ops fail or font metrics look degenerate → show fallback indicator `[4]` instead of silent wrong glyph

### API

```typescript
interface Renderer {
  mount(container: HTMLElement): void;
  update(count: number): void;
  onClick(callback: () => void): void;
  destroy(): void;
}
```

---

## Phase 3: Editor Session (`editor-session.ts`)

### Responsibilities

- Capture active editor & cursor position on session start
- Register keydown handler for `Space`, `Backspace`, `Enter`, `Esc`
- Ignore other keys (prevent editor input during tally mode)
- Register click handler on overlay
- Coordinate `TallyState` + `Renderer`
- On `Enter`: generate commit text via settings, insert at captured position
- On `Esc` / leaf change / unload: clean dispose
- Enforce single-session invariant

### Key Implementation Details

- Use `editor.getCursor()` and `editor.replaceRange(text, cursor)`
- Keydown handler attached to `window` with capture phase
- Track `activeLeaf` changes via `workspace.on('active-leaf-change', ...)`
- Cleanup function registered in session, called on all exit paths

---

## Phase 4: Settings (`settings.ts`)

```typescript
interface Settings {
  commitFormat: 'stable' | 'unicode';
}

const DEFAULT_SETTINGS: Settings = { commitFormat: 'stable' };
```

- Load/save via `plugin.loadData()` / `plugin.saveData()`
- Settings tab not required in V1 (only two options, hotkey via command palette)

---

## Phase 5: Main Plugin (`main.ts`)

- Register command `start` (bare ID; Obsidian prefixes the plugin ID automatically) with default hotkey `Alt+Z`
- Command callback: check active editor, create `EditorSession` if none active
- Register `onunload` to destroy active session
- Load settings

---

## Phase 6: Integration Tests

Using Jest with minimal Obsidian API mocks:

- Session start → Space 5× → Enter → verify inserted `正`
- Session start → Space 18× → Backspace → Space → Enter → verify `正正正·3`
- Session start → Esc → verify no insertion
- Second Alt+Z during active session → no duplicate
- Leaf switch during session → cancel
- Plugin unload → cleanup

---

## Phase 7: Verification & Deliverables

- `npm run lint` passes
- `npm run typecheck` passes
- `npm run build` produces `main.js`
- `npm test` all green
- README.md written
- `git status` clean, pushed to origin/main

---

## Commit Strategy

| Commit | Scope |
|--------|-------|
| `feat: project setup` | package.json, tsconfig, manifest, build config |
| `feat: tally-state module + tests` | tally-state.ts, tally-state.test.ts |
| `feat: renderer with font-adaptive rendering` | renderer.ts |
| `feat: editor session lifecycle` | editor-session.ts |
| `feat: settings module` | settings.ts |
| `feat: main plugin entry` | main.ts |
| `test: integration tests` | editor-session.test.ts |
| `docs: README` | README.md |
| `chore: final verify` | any fixes after full test run |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| State 4 rendering unreliable on some fonts | Explicit fallback `[N]` indicator, never silent font swap |
| Keydown capture leaks | Single cleanup function, registered on all exit paths (Esc, Enter, leaf change, unload) |
| Editor API changes | Use only documented Obsidian Editor API; avoid CodeMirror internals |
| Font inheritance fails | Fall back to `inherit` CSS, log warning |

---

## Out of Scope (V1)

Per spec: mobile, IME, multiple counters, history, Unicode default, animations, rich-text insertion.