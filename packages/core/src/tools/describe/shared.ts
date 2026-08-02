import type { SceneNode } from '@open-pencil/scene-graph'

export const CONTAINER_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE'])

export const BUTTON_MAX_WIDTH = 200
export const BUTTON_MAX_HEIGHT = 50
export const BUTTON_MIN_HEIGHT = 28
export const BUTTON_MIN_RADIUS = 2

export function looksLikeButton(node: SceneNode): boolean {
  if (!CONTAINER_TYPES.has(node.type)) return false
  if (
    node.width > BUTTON_MAX_WIDTH ||
    node.height > BUTTON_MAX_HEIGHT ||
    node.height < BUTTON_MIN_HEIGHT
  )
    return false
  if (node.fills.length === 0 && node.strokes.length === 0) return false
  if (node.cornerRadius < BUTTON_MIN_RADIUS) return false
  return node.childIds.length > 0
}
