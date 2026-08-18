import type {
  MotionEffectTarget,
  MotionFontAxisTarget,
  MotionGradientStopTarget,
  MotionKeyframe,
  MotionPaintTarget,
  MotionSpec,
  MotionVectorMorph,
  SceneNode,
  VectorNetwork
} from '@open-pencil/scene-graph'

import type { MotionVisualState } from './types'

export type MotionAdvancedChannel =
  | 'paints'
  | 'gradientStops'
  | 'effects'
  | 'cornerRadii'
  | 'textReveal'
  | 'fontAxes'
  | 'vectorMorph'

export type MotionAdvancedCapabilityCode =
  | 'paint-index-out-of-range'
  | 'paint-kind-unsupported'
  | 'paint-type-unsupported'
  | 'gradient-stop-index-out-of-range'
  | 'effect-index-out-of-range'
  | 'effect-type-mismatch'
  | 'node-type-unsupported'
  | 'vector-topology-mismatch'
  | 'vector-point-count-mismatch'

export interface MotionAdvancedCapabilityIssue {
  readonly channel: MotionAdvancedChannel
  readonly code: MotionAdvancedCapabilityCode
  readonly path: string
  readonly message: string
}

export interface MotionNodeCapabilityIssue extends MotionAdvancedCapabilityIssue {
  readonly trackId: string
  readonly keyframeIndex: number
}

export type MotionAdvancedValues = Pick<
  MotionKeyframe,
  'paints' | 'gradientStops' | 'effects' | 'cornerRadii' | 'textReveal' | 'fontAxes' | 'vectorMorph'
>

export interface MotionAdvancedProjectionResult {
  readonly node: SceneNode
  readonly issues: readonly MotionAdvancedCapabilityIssue[]
  readonly applied: boolean
}

export interface MotionAdvancedChannelTemplate {
  readonly channel: MotionAdvancedChannel
  readonly supported: boolean
  readonly reason?: string
  /** One topology-safe value suitable for enabling the channel on every keyframe. */
  readonly value?: MotionAdvancedValues[MotionAdvancedChannel]
  /** Every node-owned indexed target that can be appended without inventing resources. */
  readonly targets?: readonly unknown[]
}

const BOX_CORNER_TYPES = new Set<SceneNode['type']>([
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

function issue(
  channel: MotionAdvancedChannel,
  code: MotionAdvancedCapabilityCode,
  path: string,
  message: string
): MotionAdvancedCapabilityIssue {
  return { channel, code, path, message }
}

function itemAtNonNegativeIndex<T>(items: readonly T[], index: number): T | undefined {
  return Number.isInteger(index) && index >= 0 ? items.at(index) : undefined
}

function inspectPaintTarget(
  node: SceneNode,
  target: MotionPaintTarget,
  index: number
): MotionAdvancedCapabilityIssue | undefined {
  const path = `paints[${index}]`
  if (target.kind === 'fill') {
    const fill = itemAtNonNegativeIndex(node.fills, target.index)
    if (!fill) {
      return issue(
        'paints',
        'paint-index-out-of-range',
        `${path}.index`,
        'Fill index is unavailable'
      )
    }
    if (target.color && fill.type !== 'SOLID') {
      return issue(
        'paints',
        'paint-type-unsupported',
        `${path}.color`,
        'Indexed fill color requires a solid fill'
      )
    }
    return undefined
  }
  if (!itemAtNonNegativeIndex(node.strokes, target.index)) {
    return issue(
      'paints',
      'paint-index-out-of-range',
      `${path}.index`,
      'Stroke index is unavailable'
    )
  }
  return undefined
}

function inspectGradientStop(
  node: SceneNode,
  target: MotionGradientStopTarget,
  index: number
): MotionAdvancedCapabilityIssue | undefined {
  const path = `gradientStops[${index}]`
  if (target.kind !== 'fill') {
    return issue(
      'gradientStops',
      'paint-kind-unsupported',
      `${path}.kind`,
      'SceneGraph strokes do not carry gradient stops'
    )
  }
  const fill = itemAtNonNegativeIndex(node.fills, target.paintIndex)
  if (!fill) {
    return issue(
      'gradientStops',
      'paint-index-out-of-range',
      `${path}.paintIndex`,
      'Gradient fill index is unavailable'
    )
  }
  if (!fill.type.startsWith('GRADIENT') || !fill.gradientStops) {
    return issue(
      'gradientStops',
      'paint-type-unsupported',
      `${path}.paintIndex`,
      'Gradient-stop motion requires a gradient fill'
    )
  }
  if (!itemAtNonNegativeIndex(fill.gradientStops, target.stopIndex)) {
    return issue(
      'gradientStops',
      'gradient-stop-index-out-of-range',
      `${path}.stopIndex`,
      'Gradient stop index is unavailable'
    )
  }
  return undefined
}

function effectMatches(
  target: MotionEffectTarget,
  type: SceneNode['effects'][number]['type']
): boolean {
  return target.kind === 'blur'
    ? type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR' || type === 'FOREGROUND_BLUR'
    : type === 'DROP_SHADOW' || type === 'INNER_SHADOW'
}

function inspectEffectTarget(
  node: SceneNode,
  target: MotionEffectTarget,
  index: number
): MotionAdvancedCapabilityIssue | undefined {
  const path = `effects[${index}]`
  const effect = itemAtNonNegativeIndex(node.effects, target.index)
  if (!effect) {
    return issue(
      'effects',
      'effect-index-out-of-range',
      `${path}.index`,
      'Effect index is unavailable'
    )
  }
  if (!effectMatches(target, effect.type)) {
    return issue(
      'effects',
      'effect-type-mismatch',
      `${path}.kind`,
      `Effect ${target.index} is ${effect.type}, not ${target.kind}`
    )
  }
  return undefined
}

function topologyFingerprint(network: VectorNetwork): string {
  const segments = network.segments.map((segment) => `${segment.start}:${segment.end}`).join(',')
  const regions = network.regions
    .map(
      (region) => `${region.windingRule}:${region.loops.map((loop) => loop.join('.')).join('/')}`
    )
    .join(',')
  return `${network.vertices.length}|${segments}|${regions}`
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  let offset = 0
  while (offset < value.length) {
    hash = Math.imul(hash ^ value.charCodeAt(offset), 0x01000193)
    offset += 1
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Stable, bounded identifier for the connectivity that vector-morph points are allowed to move. */
export function motionVectorTopologyId(node: SceneNode): string | undefined {
  const network = node.type === 'VECTOR' ? node.vectorNetwork : null
  if (!network || network.vertices.length === 0) return undefined
  return `vn1-${network.vertices.length}-${network.segments.length}-${network.regions.length}-${fnv1a(topologyFingerprint(network))}`
}

function inspectVectorMorph(
  node: SceneNode,
  morph: MotionVectorMorph
): MotionAdvancedCapabilityIssue | undefined {
  if (node.type !== 'VECTOR' || !node.vectorNetwork) {
    return issue(
      'vectorMorph',
      'node-type-unsupported',
      'vectorMorph',
      'Vector morph requires a VECTOR node with a vector network'
    )
  }
  const topologyId = motionVectorTopologyId(node)
  if (morph.topologyId !== topologyId) {
    return issue(
      'vectorMorph',
      'vector-topology-mismatch',
      'vectorMorph.topologyId',
      `Expected topology ${topologyId ?? 'unavailable'}`
    )
  }
  if (morph.points.length !== node.vectorNetwork.vertices.length) {
    return issue(
      'vectorMorph',
      'vector-point-count-mismatch',
      'vectorMorph.points',
      `Expected ${node.vectorNetwork.vertices.length} vector points`
    )
  }
  return undefined
}

/** Node-aware validation shared by Canvas, compiler, authoring UI, and tools. */
export function inspectMotionAdvancedChannels(
  node: SceneNode,
  values: MotionAdvancedValues | MotionVisualState
): MotionAdvancedCapabilityIssue[] {
  const issues: MotionAdvancedCapabilityIssue[] = []
  values.paints?.forEach((target, index) => {
    const found = inspectPaintTarget(node, target, index)
    if (found) issues.push(found)
  })
  values.gradientStops?.forEach((target, index) => {
    const found = inspectGradientStop(node, target, index)
    if (found) issues.push(found)
  })
  values.effects?.forEach((target, index) => {
    const found = inspectEffectTarget(node, target, index)
    if (found) issues.push(found)
  })
  if (values.cornerRadii && !BOX_CORNER_TYPES.has(node.type)) {
    issues.push(
      issue(
        'cornerRadii',
        'node-type-unsupported',
        'cornerRadii',
        'Independent corners require box geometry'
      )
    )
  }
  if (values.textReveal !== undefined && node.type !== 'TEXT') {
    issues.push(
      issue('textReveal', 'node-type-unsupported', 'textReveal', 'Text reveal requires a TEXT node')
    )
  }
  if (values.fontAxes && node.type !== 'TEXT') {
    issues.push(
      issue('fontAxes', 'node-type-unsupported', 'fontAxes', 'Font axes require a TEXT node')
    )
  }
  if (values.vectorMorph) {
    const found = inspectVectorMorph(node, values.vectorMorph)
    if (found) issues.push(found)
  }
  return issues
}

/** Validate every node-aware v3 channel before a complete MotionSpec is committed. */
export function inspectMotionNodeCapabilities(
  node: SceneNode,
  spec: MotionSpec
): MotionNodeCapabilityIssue[] {
  if (spec.version !== 3) return []
  return spec.tracks.flatMap((track) =>
    track.keyframes.flatMap((keyframe, keyframeIndex) =>
      inspectMotionAdvancedChannels(node, keyframe).map((found) => ({
        ...found,
        trackId: track.id,
        keyframeIndex,
        path: `${track.id}.keyframes[${keyframeIndex}].${found.path}`
      }))
    )
  )
}

function paintTemplates(node: SceneNode): MotionPaintTarget[] {
  return [
    ...node.fills.map(
      (fill, index): MotionPaintTarget => ({
        kind: 'fill',
        index,
        ...(fill.type === 'SOLID' ? { color: { ...fill.color } } : {}),
        opacity: fill.opacity
      })
    ),
    ...node.strokes.map(
      (stroke, index): MotionPaintTarget => ({
        kind: 'stroke',
        index,
        color: { ...stroke.color },
        opacity: stroke.opacity
      })
    )
  ]
}

function gradientStopTemplates(node: SceneNode): MotionGradientStopTarget[] {
  return node.fills.flatMap((fill, paintIndex) =>
    (fill.gradientStops ?? []).map(
      (stop, stopIndex): MotionGradientStopTarget => ({
        kind: 'fill',
        paintIndex,
        stopIndex,
        position: stop.position,
        color: { ...stop.color }
      })
    )
  )
}

function effectTemplates(node: SceneNode): MotionEffectTarget[] {
  return node.effects.map((effect, index) => {
    if (
      effect.type === 'LAYER_BLUR' ||
      effect.type === 'BACKGROUND_BLUR' ||
      effect.type === 'FOREGROUND_BLUR'
    ) {
      return { kind: 'blur', index, radius: effect.radius }
    }
    return {
      kind: 'shadow',
      index,
      x: effect.offset.x,
      y: effect.offset.y,
      blur: effect.radius,
      spread: effect.spread,
      color: { ...effect.color }
    }
  })
}

function channelTemplateValues(
  node: SceneNode,
  channel: MotionAdvancedChannel
): { value?: MotionAdvancedValues[MotionAdvancedChannel]; targets?: readonly unknown[] } {
  if (channel === 'paints') {
    const targets = paintTemplates(node)
    return targets.length > 0 ? { value: [targets[0]], targets } : {}
  }
  if (channel === 'gradientStops') {
    const targets = gradientStopTemplates(node)
    return targets.length > 0 ? { value: [targets[0]], targets } : {}
  }
  if (channel === 'effects') {
    const targets = effectTemplates(node)
    return targets.length > 0 ? { value: [targets[0]], targets } : {}
  }
  if (channel === 'cornerRadii') {
    const uniform = {
      topLeft: node.cornerRadius,
      topRight: node.cornerRadius,
      bottomRight: node.cornerRadius,
      bottomLeft: node.cornerRadius
    }
    return {
      value: node.independentCorners
        ? {
            topLeft: node.topLeftRadius,
            topRight: node.topRightRadius,
            bottomRight: node.bottomRightRadius,
            bottomLeft: node.bottomLeftRadius
          }
        : uniform
    }
  }
  if (channel === 'textReveal') return { value: 1 }
  if (channel === 'fontAxes') {
    const targets: MotionFontAxisTarget[] = node.fontVariations.map((axis) => ({
      tag: axis.axis,
      value: axis.value
    }))
    return targets.length > 0 ? { value: [targets[0]], targets } : {}
  }
  const topologyId = motionVectorTopologyId(node)
  return topologyId && node.vectorNetwork
    ? {
        value: {
          topologyId,
          points: node.vectorNetwork.vertices.map(({ x, y }) => ({ x, y }))
        }
      }
    : {}
}

/** Build AI/UI templates directly from the same node-aware validator used by projection. */
export function motionAdvancedChannelTemplate(
  node: SceneNode,
  channel: MotionAdvancedChannel
): MotionAdvancedChannelTemplate {
  const { value, targets } = channelTemplateValues(node, channel)
  if (value === undefined) {
    return {
      channel,
      supported: false,
      reason: `No node-owned ${channel} target is available`
    }
  }
  const issues = inspectMotionAdvancedChannels(node, { [channel]: value })
  return issues.length > 0
    ? {
        channel,
        supported: false,
        reason: issues.map((found) => found.message).join('; ')
      }
    : { channel, supported: true, value, ...(targets ? { targets } : {}) }
}

export function motionAdvancedChannelTemplates(node: SceneNode): MotionAdvancedChannelTemplate[] {
  return (
    [
      'paints',
      'gradientStops',
      'effects',
      'cornerRadii',
      'textReveal',
      'fontAxes',
      'vectorMorph'
    ] as const
  ).map((channel) => motionAdvancedChannelTemplate(node, channel))
}

function projectedFills(node: SceneNode, visual: MotionVisualState): SceneNode['fills'] {
  if (!visual.paints?.some((target) => target.kind === 'fill') && !visual.gradientStops?.length) {
    return node.fills
  }
  const fills = node.fills.map((fill) => ({
    ...fill,
    color: { ...fill.color },
    ...(fill.gradientStops
      ? { gradientStops: fill.gradientStops.map((stop) => ({ ...stop, color: { ...stop.color } })) }
      : {})
  }))
  for (const target of visual.paints ?? []) {
    if (target.kind !== 'fill') continue
    const fill = itemAtNonNegativeIndex(fills, target.index)
    if (!fill) continue
    if (target.color) fill.color = { ...target.color }
    if (target.opacity !== undefined) fill.opacity = target.opacity
  }
  for (const target of visual.gradientStops ?? []) {
    if (target.kind !== 'fill') continue
    const stops = itemAtNonNegativeIndex(fills, target.paintIndex)?.gradientStops
    const stop = stops ? itemAtNonNegativeIndex(stops, target.stopIndex) : undefined
    if (!stop) continue
    stop.position = target.position
    stop.color = { ...target.color }
  }
  return fills
}

function projectedStrokes(node: SceneNode, visual: MotionVisualState): SceneNode['strokes'] {
  if (!visual.paints?.some((target) => target.kind === 'stroke')) return node.strokes
  const strokes = node.strokes.map((stroke) => ({ ...stroke, color: { ...stroke.color } }))
  for (const target of visual.paints) {
    if (target.kind !== 'stroke') continue
    const stroke = itemAtNonNegativeIndex(strokes, target.index)
    if (!stroke) continue
    if (target.color) stroke.color = { ...target.color }
    if (target.opacity !== undefined) stroke.opacity = target.opacity
  }
  return strokes
}

function projectedEffects(node: SceneNode, visual: MotionVisualState): SceneNode['effects'] {
  if (!visual.effects) return node.effects
  const effects = node.effects.map((effect) => ({
    ...effect,
    color: { ...effect.color },
    offset: { ...effect.offset }
  }))
  for (const target of visual.effects) {
    const effect = itemAtNonNegativeIndex(effects, target.index)
    if (!effect) continue
    effect.visible = true
    if (target.kind === 'blur') {
      effect.radius = target.radius
    } else {
      effect.offset = { x: target.x, y: target.y }
      effect.radius = target.blur
      effect.spread = target.spread
      effect.color = { ...target.color }
    }
  }
  return effects
}

function projectedText(node: SceneNode, progress: number): Partial<SceneNode> {
  const characters = Array.from(node.text)
  const visibleText = characters.slice(0, Math.round(characters.length * progress)).join('')
  const textLength = visibleText.length
  return {
    text: visibleText,
    styleRuns: node.styleRuns.flatMap((run) => {
      if (run.start >= textLength) return []
      return [{ ...run, length: Math.min(run.length, textLength - run.start) }]
    }),
    textPicture: null,
    derivedTextGlyphs: null,
    textPathData: null,
    textPathBox: null
  }
}

function projectedFontAxes(
  authored: SceneNode['fontVariations'],
  targets: readonly MotionFontAxisTarget[]
): SceneNode['fontVariations'] {
  const values = new Map(authored.map((axis) => [axis.axis, axis.value]))
  for (const target of targets) values.set(target.tag, target.value)
  return [...values].map(([axis, value]) => ({ axis, value }))
}

function projectedVectorNetwork(
  node: SceneNode,
  morph: MotionVectorMorph
): SceneNode['vectorNetwork'] {
  const network = node.vectorNetwork
  if (!network) return null
  return {
    ...network,
    vertices: network.vertices.map((vertex, index) => ({ ...vertex, ...morph.points[index] })),
    segments: network.segments.map((segment) => ({
      ...segment,
      tangentStart: { ...segment.tangentStart },
      tangentEnd: { ...segment.tangentEnd }
    })),
    regions: network.regions.map((region) => ({
      ...region,
      loops: region.loops.map((loop) => [...loop])
    }))
  }
}

/**
 * Apply sampled v3 structured channels without mutating authored SceneGraph data.
 * Node-incompatible target sets fail closed as one unit and return diagnostics.
 */
export function projectMotionAdvancedChannels(
  node: SceneNode,
  visual: MotionVisualState
): MotionAdvancedProjectionResult {
  const issues = inspectMotionAdvancedChannels(node, visual)
  if (issues.length > 0) return { node, issues, applied: false }
  const hasValues =
    visual.paints !== undefined ||
    visual.gradientStops !== undefined ||
    visual.effects !== undefined ||
    visual.cornerRadii !== undefined ||
    visual.textReveal !== undefined ||
    visual.fontAxes !== undefined ||
    visual.vectorMorph !== undefined
  if (!hasValues) return { node, issues, applied: false }

  const corners = visual.cornerRadii
  const vectorMorph = visual.vectorMorph
  return {
    issues,
    applied: true,
    node: {
      ...node,
      fills: projectedFills(node, visual),
      strokes: projectedStrokes(node, visual),
      effects: projectedEffects(node, visual),
      ...(corners
        ? {
            independentCorners: true,
            cornerRadius: 0,
            topLeftRadius: corners.topLeft,
            topRightRadius: corners.topRight,
            bottomRightRadius: corners.bottomRight,
            bottomLeftRadius: corners.bottomLeft
          }
        : {}),
      ...(visual.textReveal === undefined ? {} : projectedText(node, visual.textReveal)),
      ...(visual.fontAxes
        ? { fontVariations: projectedFontAxes(node.fontVariations, visual.fontAxes) }
        : {}),
      ...(vectorMorph
        ? {
            vectorNetwork: projectedVectorNetwork(node, vectorMorph),
            // Imported outline caches describe the authored vertices. The projected
            // vector network is the canonical animated geometry for this frame.
            fillGeometry: [],
            strokeGeometry: []
          }
        : {})
    }
  }
}
