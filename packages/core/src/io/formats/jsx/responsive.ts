import {
  isAutoLayoutMode,
  type ResponsiveBreakpoint,
  type ResponsiveOverride,
  type SceneNode
} from '@open-pencil/scene-graph'

import { formatTrack, type JSXStyleGraph } from './helpers'

const MIN_WIDTH_BREAKPOINTS = ['sm', 'md', 'lg', 'xl'] as const
const GRID_CONTENT_ALIGN = {
  MIN: 'start',
  CENTER: 'center',
  MAX: 'end',
  SPACE_BETWEEN: 'space-between'
} satisfies Record<SceneNode['primaryAxisAlign'], string>

export interface ResponsiveStyleContext {
  readonly override: ResponsiveOverride
}

type Style = Record<string, string>
type ResolveStyle = (
  node: SceneNode,
  graph: JSXStyleGraph,
  context?: ResponsiveStyleContext
) => Style

export interface ResponsiveStyleVariant {
  readonly prefix: string
  readonly previous: Style
  readonly style: Style
}

function overrideAt(
  node: SceneNode,
  breakpoint: ResponsiveBreakpoint
): ResponsiveOverride | undefined {
  const value = node.responsiveOverrides?.[breakpoint]
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function effectiveOverride(node: SceneNode, breakpoint: ResponsiveBreakpoint): ResponsiveOverride {
  if (breakpoint === 'compact') return overrideAt(node, breakpoint) ?? {}
  const result: ResponsiveOverride = {}
  for (const current of MIN_WIDTH_BREAKPOINTS) {
    Object.assign(result, overrideAt(node, current))
    if (current === breakpoint) break
  }
  if (breakpoint !== 'xl') Object.assign(result, overrideAt(node, 'compact'))
  return result
}

function effectiveContext(node: SceneNode, graph: JSXStyleGraph, breakpoint: ResponsiveBreakpoint) {
  const cache = new Map<string, SceneNode>()
  const getNode: JSXStyleGraph['getNode'] = (id) => {
    if (cache.has(id)) return cache.get(id)
    const original = id === node.id ? node : graph.getNode(id)
    if (!original) return undefined
    const current = { ...original, ...effectiveOverride(original, breakpoint) }
    cache.set(id, current)
    return current
  }
  return {
    graph: { getNode },
    node: getNode(node.id) ?? node,
    override: effectiveOverride(node, breakpoint)
  }
}

/** Include grid tracks and visibility in the same CSS delta as responsive positioning. */
function layoutStyle(node: SceneNode, style: Style, context?: ResponsiveStyleContext): Style {
  const result = { ...style }
  // Compare longhands so GRID row/column gaps and flex gap share one contract.
  // Otherwise switching layout can emit gap:16px plus row-gap:0px and erase it.
  if (Object.hasOwn(result, 'gap')) {
    if (!Object.hasOwn(result, 'rowGap')) result.rowGap = result.gap
    if (!Object.hasOwn(result, 'columnGap')) result.columnGap = result.gap
    delete result.gap
  }
  if (node.layoutMode === 'GRID') {
    // Opt-in keeps existing canvas GRID output unchanged. Packing implicit rows
    // prevents a fixed-height responsive list from stretching short cards.
    if (context?.override.primaryAxisAlign !== undefined)
      result.alignContent = GRID_CONTENT_ALIGN[node.primaryAxisAlign]
    for (const field of ['gridTemplateColumns', 'gridTemplateRows'] as const) {
      const tracks = node[field]
      if (!tracks.length) continue
      result[field] = tracks.every((track) => track.sizing === 'FR' && track.value === 1)
        ? `repeat(${tracks.length}, minmax(0, 1fr))`
        : tracks.map(formatTrack).join(' ')
    }
  }
  if (!node.visible) result.display = 'none'
  return result
}

function relevantBreakpoints(node: SceneNode, graph: JSXStyleGraph): Set<string> {
  const nodes = [node, ...node.childIds.map((id) => graph.getNode(id))]
  if (node.parentId) nodes.push(graph.getNode(node.parentId))
  return new Set(nodes.flatMap((current) => Object.keys(current?.responsiveOverrides ?? {})))
}

/** Track emitted min-width deltas when max-xl is absent at the desktop boundary. */
function applyStyleDelta(base: Style, previous: Style, style: Style): Style {
  let result = { ...base }
  for (const key of new Set([...Object.keys(previous), ...Object.keys(style)])) {
    if (previous[key] === style[key]) continue
    if (Object.hasOwn(style, key)) result[key] = style[key]
    else {
      const { [key]: _removed, ...remaining } = result
      result = remaining
    }
  }
  return result
}

/** A read-only graph view lets a child's positioning follow its breakpoint-effective parent. */
export function responsiveStyleVariants(
  node: SceneNode,
  graph: JSXStyleGraph,
  resolveStyle: ResolveStyle
): ResponsiveStyleVariant[] {
  const relevant = relevantBreakpoints(node, graph)
  if (relevant.size === 0) return []
  const base = layoutStyle(node, resolveStyle(node, graph))
  const variants: ResponsiveStyleVariant[] = []
  const compact = relevant.has('compact') ? effectiveContext(node, graph, 'compact') : undefined
  const compactStyle = compact
    ? layoutStyle(compact.node, resolveStyle(compact.node, compact.graph, compact), compact)
    : undefined
  let previous = compactStyle ?? base
  let desktopPrevious = base
  for (const breakpoint of MIN_WIDTH_BREAKPOINTS) {
    if (!relevant.has(breakpoint) && !(breakpoint === 'xl' && compactStyle)) continue
    const effective = effectiveContext(node, graph, breakpoint)
    const style = layoutStyle(
      effective.node,
      resolveStyle(effective.node, effective.graph, effective),
      effective
    )
    variants.push({
      prefix: breakpoint,
      previous: breakpoint === 'xl' && compactStyle ? desktopPrevious : previous,
      style
    })
    if (compactStyle && breakpoint !== 'xl')
      desktopPrevious = applyStyleDelta(desktopPrevious, previous, style)
    previous = style
  }
  if (compactStyle) variants.push({ prefix: 'max-xl', previous: base, style: compactStyle })
  return variants
}

/** Native axis sizing is opt-in for non-flex nodes when authored at a breakpoint. */
export function applyResponsiveSizing(
  style: Style,
  node: SceneNode,
  context: ResponsiveStyleContext
): void {
  const horizontal = node.layoutMode === 'HORIZONTAL'
  const fields = [
    ['primaryAxisSizing', horizontal ? 'width' : 'height'],
    ['counterAxisSizing', horizontal ? 'height' : 'width']
  ] as const
  for (const [field, dimension] of fields) {
    if (context.override[field] === undefined) continue
    const sizing = node[field]
    const values = { FIXED: `${node[dimension]}px`, HUG: 'auto', FILL: '100%' }
    style[dimension] = values[sizing]
    if (field === 'primaryAxisSizing' && sizing === 'HUG' && isAutoLayoutMode(node.layoutMode)) {
      const minimum = dimension === 'width' ? 'minWidth' : 'minHeight'
      // Overflow-clipped grid/flex items otherwise have a zero automatic minimum,
      // allowing a fixed-size ancestor to shrink a HUG card below its contents.
      if (context.override[minimum] === undefined) style[minimum] = 'min-content'
    }
  }
  for (const field of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) {
    if (context.override[field] === undefined) continue
    const value = node[field]
    const reset = field.startsWith('min') ? '0px' : 'none'
    style[field] = value === null ? reset : `${value}px`
  }
}
