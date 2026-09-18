// Obsidian declares `createEl` / `createDiv` as globals (obsidian.d.ts wraps
// them in `declare global`), so they have no module import to mock. Under
// jsdom they reduce to plain element creation — in the real app they also
// resolve against the correct window, which is what makes them preferable
// to `document.createElement` inside pop-out windows.
type ElFactory = (tag: string) => HTMLElement;

(globalThis as unknown as { createEl: ElFactory }).createEl = (tag: string) =>
  document.createElement(tag);

(globalThis as unknown as { createDiv: () => HTMLDivElement }).createDiv = () =>
  document.createElement('div');
