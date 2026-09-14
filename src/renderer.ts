import type { Editor } from 'obsidian';

interface CodeMirrorEditor {
  wrapperElement: HTMLElement;
}

interface EditorWithCM extends Editor {
  cm: CodeMirrorEditor;
}

export interface TallyRenderer {
  mount(container: HTMLElement): void;
  update(count: number): void;
  onClick(callback: () => void): void;
  destroy(): void;
}

const PARTIAL_GLYPHS = ['', '一', '丁', '下'] as const;
const FULL_GLYPH = '正';

interface EditorTypography {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
}

function readEditorTypography(editor: Editor): EditorTypography {
  const cm = (editor as EditorWithCM).cm;
  const wrapper = cm?.wrapperElement;
  const computed = wrapper ? getComputedStyle(wrapper) : getComputedStyle(document.body);
  return {
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    fontWeight: computed.fontWeight,
    fontStyle: computed.fontStyle,
    color: computed.color,
  };
}

function applyTypography(el: HTMLElement, typo: EditorTypography): void {
  el.style.fontFamily = typo.fontFamily;
  el.style.fontSize = typo.fontSize;
  el.style.fontWeight = typo.fontWeight;
  el.style.fontStyle = typo.fontStyle;
  el.style.color = typo.color;
}

function createState4Canvas(typo: EditorTypography): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const fontSizePx = parseFloat(typo.fontSize) || 16;
  const font = `${typo.fontStyle} ${typo.fontWeight} ${fontSizePx}px ${typo.fontFamily}`;

  canvas.width = fontSizePx;
  canvas.height = fontSizePx;
  ctx.font = font;
  ctx.textBaseline = 'top';
  ctx.fillStyle = typo.color;
  ctx.fillText(FULL_GLYPH, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const cutoffY = Math.floor(canvas.height * 0.8);

  for (let y = cutoffY; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4 + 3;
      data[idx] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function createTallyRenderer(editor: Editor): TallyRenderer {
  const typo = readEditorTypography(editor);
  let clickCallback: (() => void) | null = null;
  let overlay: HTMLElement | null = null;
  let tallyContainer: HTMLElement | null = null;
  let countDisplay: HTMLElement | null = null;
  let state4Canvas: HTMLCanvasElement | null = null;
  let state4Failed = false;

  function buildOverlay(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'zheng-tally-overlay';
    root.style.cssText = `
      position: fixed;
      z-index: 1000;
      pointer-events: none;
      font-family: inherit;
    `;

    const inner = document.createElement('div');
    inner.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 0.35em;
      padding: 0.2em 0.4em;
      background: var(--background-secondary, #fafafa);
      border: 1px solid var(--background-modifier-border, #ccc);
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      pointer-events: auto;
      white-space: nowrap;
    `;
    applyTypography(inner, typo);

    tallyContainer = document.createElement('span');
    tallyContainer.style.cssText = `
      display: inline-flex;
      gap: 0.15em;
      line-height: 1;
    `;
    applyTypography(tallyContainer, typo);

    countDisplay = document.createElement('span');
    countDisplay.style.cssText = `
      font-size: 0.75em;
      opacity: 0.7;
      font-variant-numeric: tabular-nums;
    `;
    applyTypography(countDisplay, typo);

    inner.appendChild(tallyContainer);
    inner.appendChild(countDisplay);
    root.appendChild(inner);

    inner.addEventListener('click', () => {
      if (clickCallback) clickCallback();
    });

    return root;
  }

  function renderTally(count: number): void {
    if (!tallyContainer) return;
    tallyContainer.innerHTML = '';

    const q = Math.floor(count / 5);
    const r = count % 5;

    for (let i = 0; i < q; i++) {
      const span = document.createElement('span');
      span.textContent = FULL_GLYPH;
      applyTypography(span, typo);
      tallyContainer.appendChild(span);
    }

    if (r > 0) {
      const span = document.createElement('span');
      applyTypography(span, typo);
      if (r <= 3) {
        span.textContent = PARTIAL_GLYPHS[r];
      } else if (r === 4) {
        if (!state4Failed) {
          if (!state4Canvas) {
            state4Canvas = createState4Canvas(typo);
          }
          if (state4Canvas) {
            const img = document.createElement('img');
            img.src = state4Canvas.toDataURL('image/png');
            img.style.cssText = `
              display: inline-block;
              width: 1em;
              height: 1em;
              vertical-align: text-bottom;
            `;
            span.appendChild(img);
          } else {
            state4Failed = true;
            span.textContent = '[4]';
            span.style.opacity = '0.6';
          }
        } else {
          span.textContent = '[4]';
          span.style.opacity = '0.6';
        }
      }
      tallyContainer.appendChild(span);
    }

    if (countDisplay) {
      countDisplay.textContent = String(count);
    }
  }

  return {
    mount(container: HTMLElement) {
      overlay = buildOverlay();
      container.appendChild(overlay);
      renderTally(0);
    },
    update(count: number) {
      renderTally(count);
    },
    onClick(callback: () => void) {
      clickCallback = callback;
    },
    destroy() {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      overlay = null;
      tallyContainer = null;
      countDisplay = null;
      state4Canvas = null;
      clickCallback = null;
    },
  };
}

export { readEditorTypography, applyTypography, createState4Canvas };
export type { EditorTypography };