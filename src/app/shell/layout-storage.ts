import { IS_BROWSER } from '@open-pencil/core/constants'

const EDITOR_LAYOUT_KEY = 'open-pencil:editor-layout'
const DEFAULT_EDITOR_LAYOUT: [number, number, number] = [18, 64, 18]
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
  const value = saved.length === 4 ? saved[3] : PREVIEW_PANEL_DEFAULT
  return typeof value === 'number' && value >= 2 && value <= 50 ? value : PREVIEW_PANEL_DEFAULT
}

/**
 * Scale the three editor panels into the space left by the optional preview.
 * Legacy three-panel layouts sum to 100; passing them unchanged alongside a
 * new 20% preview makes Reka normalize a 120% layout and logs a warning.
 */
export function editorPanelDefaultSizes(
  saved: number[],
  includePreview: boolean
): [number, number, number] {
  const base = [
    saved[0] ?? DEFAULT_EDITOR_LAYOUT[0],
    saved[1] ?? DEFAULT_EDITOR_LAYOUT[1],
    saved[2] ?? DEFAULT_EDITOR_LAYOUT[2]
  ] as [number, number, number]
  const total = base.reduce((sum, size) => sum + size, 0)
  const available = includePreview ? 100 - previewPanelDefaultSize(saved) : 100
  if (Math.abs(total - available) < 0.001) return base
  if (total <= 0)
    return DEFAULT_EDITOR_LAYOUT.map((size) => (size / 100) * available) as [number, number, number]
  return base.map((size) => (size / total) * available) as [number, number, number]
}

export function saveEditorLayout(layout: number[]): void {
  if (!IS_BROWSER) return
  window.localStorage.setItem(EDITOR_LAYOUT_KEY, JSON.stringify(layout))
}
