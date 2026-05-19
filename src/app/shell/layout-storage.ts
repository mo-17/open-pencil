import { IS_BROWSER } from '@open-pencil/core/constants'

const EDITOR_LAYOUT_KEY = 'open-pencil:editor-layout'
const DEFAULT_EDITOR_LAYOUT = [18, 64, 18]
const PREVIEW_PANEL_DEFAULT = 20

export function loadEditorLayout(): number[] {
  if (!IS_BROWSER) return DEFAULT_EDITOR_LAYOUT
  try {
    const raw = window.localStorage.getItem(EDITOR_LAYOUT_KEY)
    if (!raw) return DEFAULT_EDITOR_LAYOUT
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) &&
      (parsed.length === 3 || parsed.length === 4) &&
      parsed.every((v) => typeof v === 'number')
      ? parsed
      : DEFAULT_EDITOR_LAYOUT
  } catch {
    return DEFAULT_EDITOR_LAYOUT
  }
}

/** Default size for the lowcode preview panel when first shown. */
export function previewPanelDefaultSize(saved: number[]): number {
  return saved.length === 4 ? saved[3] : PREVIEW_PANEL_DEFAULT
}

export function saveEditorLayout(layout: number[]): void {
  if (!IS_BROWSER) return
  window.localStorage.setItem(EDITOR_LAYOUT_KEY, JSON.stringify(layout))
}
