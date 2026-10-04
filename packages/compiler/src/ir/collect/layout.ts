import {
  isAutoLayoutMode,
  type ResponsiveOverride,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import type { IRLayout, IRResponsiveLayout } from '../layout'
import { tailwindClassName, type CompilerStyleOptions } from '../style'

const MIN_WIDTH_BREAKPOINTS = [
  ['sm', 640],
  ['md', 768],
  ['lg', 1024],
  ['xl', 1280]
] as const

const LAYOUT_FIELDS = [
  'x',
  'y',
  'width',
  'height',
  'layoutMode',
  'layoutDirection',
  'layoutWrap',
  'layoutPositioning',
  'layoutGrow',
  'layoutAlignSelf',
  'primaryAxisSizing',
  'counterAxisSizing',
  'primaryAxisAlign',
  'counterAxisAlign',
  'counterAxisAlignContent',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'itemSpacing',
  'counterAxisSpacing',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridColumnGap',
  'gridRowGap',
  'gridPosition',
  'clipsContent',
  'visible',
  'fontSize',
  'lineHeight'
] as const satisfies readonly (keyof SceneNode)[]

function responsiveOverride(node: SceneNode, width: number): ResponsiveOverride {
  const result: ResponsiveOverride = {}
  for (const [breakpoint, minWidth] of MIN_WIDTH_BREAKPOINTS) {
    if (width < minWidth) break
    Object.assign(result, node.responsiveOverrides?.[breakpoint])
  }
  if (width < 1280) Object.assign(result, node.responsiveOverrides?.compact)
  return result
}

function layoutSnapshot(
  node: SceneNode,
  parent: SceneNode | undefined,
  override: ResponsiveOverride = {}
): IRLayout {
  const horizontal = node.layoutMode === 'HORIZONTAL'
  const canvasFlow = parent?.type === 'CANVAS' && override.layoutPositioning === 'AUTO'
  const parentFree = parent?.type === 'CANVAS' || (parent && !isAutoLayoutMode(parent.layoutMode))
  return {
    ...(structuredClone(
      Object.fromEntries(LAYOUT_FIELDS.map((field) => [field, node[field]]))
    ) as Pick<SceneNode, (typeof LAYOUT_FIELDS)[number]>),
    sourceType: node.type,
    position:
      canvasFlow || (!parentFree && node.layoutPositioning !== 'ABSOLUTE') ? 'flow' : 'absolute',
    ...(parent ? { parentLayoutMode: parent.layoutMode, parentType: parent.type } : {}),
    widthSizing: horizontal ? node.primaryAxisSizing : node.counterAxisSizing,
    heightSizing: horizontal ? node.counterAxisSizing : node.primaryAxisSizing
  }
}

function hasResponsiveContext(node: SceneNode, graph: SceneGraph): boolean {
  const related = [node, ...node.childIds.map((id) => graph.getNode(id))]
  if (node.parentId) related.push(graph.getNode(node.parentId))
  return related.some(
    (current) => current && Object.keys(current.responsiveOverrides ?? {}).length > 0
  )
}

function resolvedGraph(graph: SceneGraph, node: SceneNode, width: number): SceneGraph {
  const cache = new Map<string, SceneNode>()
  const getNode = (id: string): SceneNode | undefined => {
    const existing = cache.get(id)
    if (existing) return existing
    const original = id === node.id ? node : graph.getNode(id)
    if (!original) return undefined
    const effective: SceneNode = {
      ...original,
      ...responsiveOverride(original, width),
      responsiveOverrides: undefined
    }
    cache.set(id, effective)
    return effective
  }
  // Keep the public graph interface while overriding only its read projection.
  return new Proxy(graph, {
    get(target, key, receiver) {
      return key === 'getNode' ? getNode : Reflect.get(target, key, receiver)
    }
  })
}

/** Resolve inherited min-width and final compact overrides before any native adapter runs. */
export function collectLayoutFields(
  node: SceneNode,
  graph: SceneGraph,
  options: CompilerStyleOptions = {}
): { layout: IRLayout; responsiveLayout?: IRResponsiveLayout[] } {
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined
  const layout = layoutSnapshot(node, parent)
  if (!hasResponsiveContext(node, graph)) return { layout }
  const widths = [0, ...MIN_WIDTH_BREAKPOINTS.map(([, width]) => width)]
  const responsiveLayout = widths.map((minWidth, index): IRResponsiveLayout => {
    const contextGraph = resolvedGraph(graph, node, minWidth)
    const effective = contextGraph.getNode(node.id) ?? node
    const effectiveParent = node.parentId ? contextGraph.getNode(node.parentId) : undefined
    const maxWidth = widths.at(index + 1)
    return {
      minWidth,
      ...(maxWidth !== undefined ? { maxWidth } : {}),
      layout: layoutSnapshot(effective, effectiveParent, responsiveOverride(node, minWidth)),
      className: tailwindClassName(effective, contextGraph, options)
    }
  })
  return { layout, responsiveLayout }
}
