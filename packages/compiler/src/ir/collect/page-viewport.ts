import { colorToHex8 } from '@open-pencil/core/color'
import { LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY, validateLowcodePageViewport } from '@open-pencil/lowcode'
import { computeBounds, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import type { IRPageViewport } from '../layout'
import type { IRWarning } from '../types'

function hasInertPolicy(page: SceneNode): boolean {
  return page.pluginData.some(
    (entry) => entry.pluginId === 'open-pencil' && entry.key === LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY
  )
}

function emittedDesignBox(node: SceneNode): boolean {
  return (
    node.visible ||
    Object.values(node.responsiveOverrides ?? {}).some((override) => override.visible === true)
  )
}

function validGeometry(node: SceneNode): boolean {
  return (
    [node.x, node.y, node.width, node.height].every(Number.isFinite) &&
    node.width >= 0 &&
    node.height >= 0
  )
}

function pageBackground(page: SceneNode): string | undefined {
  const fill = page.fills.find((candidate) => candidate.visible && candidate.type === 'SOLID')
  if (!fill) return undefined
  const { r, g, b, a } = fill.color
  if (
    ![r, g, b, a, fill.opacity].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
  )
    return undefined
  return colorToHex8({ ...fill.color, a: a * fill.opacity })
}

/** Missing policy is the compatibility path; malformed authoring never invents page dimensions. */
export function collectPageViewport(
  page: SceneNode,
  graph: SceneGraph,
  warnings: IRWarning[]
): IRPageViewport | undefined {
  if (page.lowcodePageViewport === undefined && !hasInertPolicy(page)) return undefined
  const validated = validateLowcodePageViewport(page.lowcodePageViewport)
  if (page.type !== 'CANVAS' || hasInertPolicy(page) || !validated.ok) {
    warnings.push({
      code: 'page-viewport-invalid',
      nodeId: page.id,
      message:
        'Page viewport policy is malformed or unsupported; legacy fixed-size output retained.'
    })
    return undefined
  }
  const children = graph.getChildren(page.id).filter(emittedDesignBox)
  const bounds = computeBounds(children)
  if (
    children.length === 0 ||
    children.some((node) => !validGeometry(node)) ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    warnings.push({
      code: 'page-viewport-bounds-invalid',
      nodeId: page.id,
      message:
        'Page viewport requires finite, non-negative design boxes with positive total bounds; legacy fixed-size output retained.'
    })
    return undefined
  }
  const backgroundColor = pageBackground(page)
  return {
    ...validated.value,
    designWidth: bounds.width,
    designHeight: bounds.height,
    originX: bounds.x,
    originY: bounds.y,
    ...(backgroundColor ? { backgroundColor } : {})
  }
}
