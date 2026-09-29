import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

/** Shared native-control defaults. Independent of editor chrome and optional web UI-kit themes. */
export const LOWCODE_SWITCH_APPEARANCE = Object.freeze({
  trackOff: '#cbd5e1',
  trackOn: '#2563eb',
  thumb: '#ffffff',
  disabledOpacity: 0.45,
  thumbHeightRatio: 0.8,
  thumbMaxWidthRatio: 0.5,
  thumbInsetRatio: 0.1,
  transitionMs: 160
})

export interface LowcodeSwitchGeometry {
  thumb: Rect
  trackRadius: number
}

/** Match the generated CSS border-box and its content-sized query container. */
export function lowcodeSwitchGeometry(
  node: Pick<
    SceneNode,
    'width' | 'height' | 'paddingLeft' | 'paddingRight' | 'paddingTop' | 'paddingBottom' | 'strokes'
  >,
  checked: boolean
): LowcodeSwitchGeometry | null {
  const strokes = node.strokes.filter((item) => item.visible)
  const border = strokes.length === 1 ? Math.max(0, strokes[0].weight) : 0
  const x = Math.max(0, node.paddingLeft) + border
  const y = Math.max(0, node.paddingTop) + border
  const width = node.width - x - Math.max(0, node.paddingRight) - border
  const height = node.height - y - Math.max(0, node.paddingBottom) - border
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const style = LOWCODE_SWITCH_APPEARANCE
  const diameter = Math.min(height * style.thumbHeightRatio, width * style.thumbMaxWidthRatio)
  const inset = Math.min(width, height) * style.thumbInsetRatio
  return {
    trackRadius: Math.min(node.width, node.height) / 2,
    thumb: {
      x: x + (checked ? width - inset - diameter : inset),
      y: y + (height - diameter) / 2,
      width: diameter,
      height: diameter
    }
  }
}
