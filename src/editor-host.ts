import type { Editor, EditorPosition } from 'obsidian';
import type { ZhengTypography } from './zheng-progressive';

export interface ScreenCoords {
  left: number;
  top: number;
  bottom: number;
}

export interface ResolvedEditorHost {
  editor: Editor;
  dom: HTMLElement;
  offset: number;
  coords: ScreenCoords;
  typography: ZhengTypography;
}

interface CmViewLike {
  dom?: unknown;
  coordsAtPos?: unknown;
}

function getDevicePixelRatio(): number {
  try {
    const dpr =
      typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
        ? window.devicePixelRatio
        : 1;
    if (!Number.isFinite(dpr) || dpr <= 0) return 1;
    return dpr;
  } catch {
    return 1;
  }
}

function isValidCoords(v: unknown): v is ScreenCoords {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.left === 'number' &&
    Number.isFinite(c.left) &&
    typeof c.top === 'number' &&
    Number.isFinite(c.top) &&
    typeof c.bottom === 'number' &&
    Number.isFinite(c.bottom)
  );
}

/** Single centralized access to non-public CM6 view. All other src files must not touch editor.cm. */
function getCmView(editor: Editor): CmViewLike | null {
  try {
    const withCm = editor as unknown as { cm?: unknown };
    if (!withCm || typeof withCm !== 'object' || !withCm.cm) return null;
    const cm = withCm.cm as CmViewLike;
    if (!cm || typeof cm !== 'object') return null;
    return cm;
  } catch {
    return null;
  }
}

function readTypographyFromDom(dom: HTMLElement): ZhengTypography | null {
  try {
    const computed = getComputedStyle(dom);
    if (!computed) return null;
    return {
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      fontStyle: computed.fontStyle,
      color: computed.color,
      devicePixelRatio: getDevicePixelRatio(),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve CM6 host fail-closed. Returns null when host, offset, coords or DOM
 * cannot be resolved. Caller must return false without side effects.
 */
export function resolveEditorHost(editor: Editor): ResolvedEditorHost | null {
  try {
    if (!editor) return null;
    if (typeof (editor as Partial<Editor>).getCursor !== 'function') return null;
    if (typeof (editor as Partial<Editor>).posToOffset !== 'function') return null;

    let cursor: EditorPosition;
    try {
      cursor = editor.getCursor();
    } catch {
      return null;
    }
    if (!cursor || typeof cursor.line !== 'number' || typeof cursor.ch !== 'number') return null;

    let offset: number;
    try {
      offset = editor.posToOffset(cursor);
    } catch {
      return null;
    }
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) return null;

    const cm = getCmView(editor);
    if (!cm) return null;
    if (!cm.dom || !(cm.dom instanceof HTMLElement)) return null;
    if (typeof cm.coordsAtPos !== 'function') return null;

    let coords: ScreenCoords;
    try {
      const raw = (cm.coordsAtPos as (off: number) => unknown)(offset);
      if (!isValidCoords(raw)) return null;
      coords = { left: raw.left, top: raw.top, bottom: raw.bottom };
    } catch {
      return null;
    }

    const dom = cm.dom;
    const typography = readTypographyFromDom(dom);
    if (!typography) return null;
    if (!typography.fontFamily || !typography.fontSize || !typography.color) return null;

    return { editor, dom, offset, coords, typography };
  } catch {
    return null;
  }
}

export type { ZhengTypography };
