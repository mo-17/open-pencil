import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { DragResize } from '#vue/shared/input/types'
import { axisSizingPatchForParent } from '#vue/shared/layout/sizing'

export function snapshotResizeSizing(node: SceneNode): NonNullable<DragResize['originalSizing']> {
  return {
    primaryAxisSizing: node.primaryAxisSizing,
    counterAxisSizing: node.counterAxisSizing,
    layoutGrow: node.layoutGrow,
    layoutAlignSelf: node.layoutAlignSelf,
    textAutoResize: node.textAutoResize
  }
}

/** Match the numeric fields: only an actually changed dimension becomes fixed. */
export function resizeSizingPatch(
  drag: DragResize,
  node: SceneNode,
  parent: SceneNode | null,
  rect: Rect
): Partial<SceneNode> {
  drag.originalSizing ??= snapshotResizeSizing(node)
  const original = { ...node, ...drag.originalSizing }
  const patch: Partial<SceneNode> = { ...drag.originalSizing }
  const widthChanged = rect.width !== drag.origRect.width
  const heightChanged = rect.height !== drag.origRect.height
  if (drag.originalDerivedLayout === undefined)
    drag.originalDerivedLayout = node.derivedLayout ? { ...node.derivedLayout } : null
  if (drag.originalDerivedLayout) {
    const derived = { ...drag.originalDerivedLayout }
    if (widthChanged) delete derived.width
    if (heightChanged) delete derived.height
    patch.derivedLayout = derived
  }
  if (widthChanged)
    Object.assign(patch, axisSizingPatchForParent(original, 'width', 'FIXED', parent))
  if (heightChanged)
    Object.assign(patch, axisSizingPatchForParent(original, 'height', 'FIXED', parent))
  if (node.type === 'TEXT' && !node.textPathData) {
    if (heightChanged) patch.textAutoResize = 'NONE'
    else if (widthChanged && original.textAutoResize === 'WIDTH_AND_HEIGHT')
      patch.textAutoResize = 'HEIGHT'
  }
  return patch
}

/** Clamp before scaling paths and preserve the stationary edge (or Shift center). */
export function limitResizeRect(
  drag: DragResize,
  node: SceneNode,
  requested: Rect,
  constrain: boolean
): Rect {
  const rect = { ...requested }
  const proportional = constrain ? limitedProportionalSize(drag.origRect, node, requested) : null
  for (const axis of ['width', 'height'] as const) {
    if (requested[axis] === drag.origRect[axis]) continue
    const horizontal = axis === 'width'
    const min = (horizontal ? node.minWidth : node.minHeight) ?? 1
    const max = (horizontal ? node.maxWidth : node.maxHeight) ?? Infinity
    const size = proportional?.[axis] ?? Math.max(1, min, Math.min(max, requested[axis]))
    const position = horizontal ? 'x' : 'y'
    const leading = drag.handle.includes(horizontal ? 'w' : 'n')
    const trailing = drag.handle.includes(horizontal ? 'e' : 's')
    let anchorFactor = 0.5
    if (leading) anchorFactor = 1
    else if (trailing) anchorFactor = 0
    const anchor = drag.origRect[position] + drag.origRect[axis] * anchorFactor
    const ratio = Math.max(0, Math.min(1, (anchor - requested[position]) / requested[axis]))
    rect[position] += (requested[axis] - size) * ratio
    rect[axis] = size
  }
  return rect
}

function limitedProportionalSize(original: Rect, node: SceneNode, requested: Rect) {
  if (original.width <= 0 || original.height <= 0) return null
  const minimum = Math.max(
    Math.max(1, node.minWidth ?? 1) / original.width,
    Math.max(1, node.minHeight ?? 1) / original.height
  )
  const maximum = Math.min(
    (node.maxWidth ?? Infinity) / original.width,
    (node.maxHeight ?? Infinity) / original.height
  )
  // Conflicting constraints have no proportional solution; retain the existing
  // independent-axis min/max priority instead of silently discarding a limit.
  if (minimum > maximum) return null
  const scale = Math.max(minimum, Math.min(maximum, requested.width / original.width))
  return { width: original.width * scale, height: original.height * scale }
}
