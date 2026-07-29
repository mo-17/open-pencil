import { isAutoLayoutMode, type NodeType, type SceneNode } from '@open-pencil/scene-graph'

import type { MotionV2ColorChannel, MotionV2NumericChannel } from './v2'

export type MotionV2ChannelCapabilityReason =
  | 'booleanResult'
  | 'solidFill'
  | 'stroke'
  | 'vectorStroke'
  | 'centerlineStroke'
  | 'vectorGeometry'
  | 'boxCorners'
  | 'autoLayout'

type MotionV2AdvancedChannel = MotionV2ColorChannel | MotionV2NumericChannel

export type MotionNodeAuthoringCapabilityReason = 'booleanResult'

const VECTOR_TRIM_NODE_TYPES: ReadonlySet<NodeType> = new Set([
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'POLYGON',
  'LINE'
])

// These nodes reach Canvas/compiler box geometry that consumes cornerRadius.
// SECTION and COMPONENT_SET are deliberately excluded because their editor
// chrome uses a fixed radius; path, text, ellipse, group, and canvas nodes do
// not expose animated box corners consistently across both renderers.
const BOX_CORNER_NODE_TYPES: ReadonlySet<NodeType> = new Set([
  'FRAME',
  'RECTANGLE',
  'ROUNDED_RECTANGLE',
  'COMPONENT',
  'INSTANCE',
  'SHAPE_WITH_TEXT',
  'INPUT',
  'BUTTON',
  'SELECT',
  'CHECKBOX',
  'FORM',
  'LIST',
  'RADIO',
  'TEXTAREA',
  'DATEPICKER',
  'SWITCH'
])

const VECTOR_TRIM_CHANNELS: ReadonlySet<MotionV2AdvancedChannel> = new Set([
  'trimStart',
  'trimEnd',
  'trimOffset'
])

const AUTO_LAYOUT_CHANNELS: ReadonlySet<MotionV2AdvancedChannel> = new Set([
  'gap',
  'rowGap',
  'columnGap',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft'
])

function hasVectorCenterlineGeometry(node: SceneNode | undefined): boolean {
  if (node?.type !== 'VECTOR') return true
  // Imported fill/stroke outlines are already expanded paths, not a stroke
  // centerline. Their color can vary, but animated width/trim would switch
  // geometry semantics between Canvas and compiled SVG.
  return (node.vectorNetwork?.segments.length ?? 0) > 0
}

function hasDrawableVectorFillGeometry(node: SceneNode | undefined): boolean {
  if (node?.type !== 'VECTOR') return true
  return (node.vectorNetwork?.segments.length ?? 0) > 0 || node.fillGeometry.length > 0
}

function hasDrawableVectorStrokeGeometry(node: SceneNode | undefined): boolean {
  if (node?.type !== 'VECTOR') return true
  return (node.vectorNetwork?.segments.length ?? 0) > 0 || node.strokeGeometry.length > 0
}

function strokeCapabilityReason(
  node: SceneNode | undefined,
  channel: 'strokeColor' | 'strokeWidth'
): MotionV2ChannelCapabilityReason | null {
  if (!node?.strokes.some((stroke) => stroke.visible)) return 'stroke'
  if (channel === 'strokeColor' && !hasDrawableVectorStrokeGeometry(node)) {
    return 'vectorGeometry'
  }
  return channel === 'strokeWidth' && !hasVectorCenterlineGeometry(node) ? 'centerlineStroke' : null
}

function trimCapabilityReason(node: SceneNode | undefined): MotionV2ChannelCapabilityReason | null {
  if (
    !node ||
    !VECTOR_TRIM_NODE_TYPES.has(node.type) ||
    !node.strokes.some((stroke) => stroke.visible)
  ) {
    return 'vectorStroke'
  }
  return hasVectorCenterlineGeometry(node) ? null : 'centerlineStroke'
}

/**
 * Returns why Motion cannot be authored or previewed for the whole node.
 *
 * A BOOLEAN_OPERATION without a resolved final fill path is intentionally
 * fail-closed: Canvas can still inspect its operands, but headless SVG/React
 * output cannot reproduce the Boolean result without changing its semantics.
 */
export function motionNodeAuthoringCapabilityReason(
  node: SceneNode | undefined
): MotionNodeAuthoringCapabilityReason | null {
  return node?.type === 'BOOLEAN_OPERATION' && node.fillGeometry.length === 0
    ? 'booleanResult'
    : null
}

export function motionNodeAuthoringSupported(node: SceneNode | undefined): boolean {
  return motionNodeAuthoringCapabilityReason(node) === null
}

/** Returns why authoring this channel would have no visible effect on the node. */
export function motionV2ChannelCapabilityReason(
  node: SceneNode | undefined,
  channel: MotionV2AdvancedChannel
): MotionV2ChannelCapabilityReason | null {
  const nodeReason = motionNodeAuthoringCapabilityReason(node)
  if (nodeReason) return nodeReason

  if (channel === 'fillColor') {
    if (!node?.fills.some((fill) => fill.visible && fill.type === 'SOLID')) return 'solidFill'
    return hasDrawableVectorFillGeometry(node) ? null : 'vectorGeometry'
  }

  if (channel === 'strokeColor' || channel === 'strokeWidth') {
    return strokeCapabilityReason(node, channel)
  }

  if (channel === 'cornerRadius') {
    return node && BOX_CORNER_NODE_TYPES.has(node.type) ? null : 'boxCorners'
  }

  if (VECTOR_TRIM_CHANNELS.has(channel)) {
    return trimCapabilityReason(node)
  }

  if (AUTO_LAYOUT_CHANNELS.has(channel)) {
    return node && isAutoLayoutMode(node.layoutMode) ? null : 'autoLayout'
  }

  return null
}

export function motionV2ChannelSupported(
  node: SceneNode | undefined,
  channel: MotionV2AdvancedChannel
): boolean {
  return motionV2ChannelCapabilityReason(node, channel) === null
}
