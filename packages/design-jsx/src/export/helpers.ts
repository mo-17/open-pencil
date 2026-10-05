import {
  isAutoLayoutMode,
  type SceneGraph,
  type SceneNode,
  type Color,
  type Effect,
  type Fill,
  type Stroke,
  type GridTrack
} from '@open-pencil/scene-graph'
import { colorToHex8 } from '@open-pencil/scene-graph/color'

export function formatColor(color: Color, opacity = 1): string {
  return colorToHex8(color, opacity)
}

export function formatShadow(e: Effect): string | null {
  if (e.type !== 'DROP_SHADOW' && e.type !== 'INNER_SHADOW') return null
  return `${e.offset.x} ${e.offset.y} ${e.radius} ${formatColor(e.color, e.color.a)}`
}

const JSX_ENTITY: Record<string, string> = {
  '{': '&#123;',
  '}': '&#125;',
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;'
}

export function escapeJSXText(text: string): string {
  return text.replace(/[{}<>&]/g, (c) => JSX_ENTITY[c])
}

export function formatProp(key: string, value: unknown): string {
  if (typeof value === 'string') {
    if (/["\\\r\n]/.test(value)) return `${key}={${JSON.stringify(value)}}`
    return `${key}="${value}"`
  }
  if (typeof value === 'number') return `${key}={${value}}`
  if (typeof value === 'boolean') return value ? key : `${key}={false}`
  return `${key}={${JSON.stringify(value)}}`
}

export type JSXStyleGraph = Pick<SceneGraph, 'getNode'>

export function getNodeContext(node: SceneNode, graph: JSXStyleGraph) {
  const parent = node.parentId ? graph.getNode(node.parentId) : null
  return {
    isAutoLayout: isAutoLayoutMode(node.layoutMode),
    isGrid: node.layoutMode === 'GRID',
    isFlex: node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL',
    parentIsAutoLayout: parent ? isAutoLayoutMode(parent.layoutMode) : false,
    parentIsGrid: parent ? parent.layoutMode === 'GRID' : false,
    // Canvas rendering positions children of every non-auto-layout container
    // from their stored x/y coordinates. Treat both the legacy default NONE
    // and the explicit FREE mode the same way here so generated code matches
    // the editor instead of falling back to normal document flow.
    parentIsFreeLayout: parent
      ? parent.type === 'CANVAS' || !isAutoLayoutMode(parent.layoutMode)
      : false
  }
}

export type PaddingEdges = { pt: number; pr: number; pb: number; pl: number }

export function collectPadding(node: SceneNode): PaddingEdges | null {
  const { paddingTop: pt, paddingRight: pr, paddingBottom: pb, paddingLeft: pl } = node
  if (pt === 0 && pr === 0 && pb === 0 && pl === 0) return null
  return { pt, pr, pb, pl }
}

export function emitPadding<T>(
  edges: PaddingEdges,
  uniform: (v: number) => T,
  symmetric: (y: number, x: number) => T[],
  individual: (edges: PaddingEdges) => T[]
): T[] {
  const { pt, pr, pb, pl } = edges
  if (pt === pr && pr === pb && pb === pl) return [uniform(pt)]
  if (pt === pb && pl === pr) return symmetric(pt, pl)
  return individual(edges)
}

export interface CornerRadii {
  tl: number
  tr: number
  br: number
  bl: number
}

export function collectCornerRadii(node: SceneNode): CornerRadii | null {
  if (node.independentCorners) {
    const corners = {
      tl: node.topLeftRadius,
      tr: node.topRightRadius,
      br: node.bottomRightRadius,
      bl: node.bottomLeftRadius
    }
    return Object.values(corners).some((radius) => radius > 0) ? corners : null
  }
  if (node.cornerRadius <= 0) return null
  const r = node.cornerRadius
  return { tl: r, tr: r, br: r, bl: r }
}

export function formatTrack(t: GridTrack): string {
  if (t.sizing === 'FR') return `${t.value}fr`
  if (t.sizing === 'FIXED') return `${t.value}px`
  return 'auto'
}

export function formatTracks(tracks: GridTrack[]): string {
  return tracks.map(formatTrack).join(' ')
}

export function solidFillColor(fills: Fill[]): string | null {
  const fill = fills.find((paint) => paint.type === 'SOLID' && paint.visible)
  return fill ? formatColor(fill.color, fill.opacity) : null
}
export function solidStroke(strokes: Stroke[]): { color: string; weight: number } | null {
  const stroke = strokes.find(
    (paint) => paint.visible && paint.weight > 0 && (paint.type ?? 'SOLID') === 'SOLID'
  )
  return stroke ? { color: formatColor(stroke.color, stroke.opacity), weight: stroke.weight } : null
}
