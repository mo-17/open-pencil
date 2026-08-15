import { DEFAULT_SHADOW_COLOR } from '@open-pencil/core/constants'
import { vectorNetworkToSVGPaths } from '@open-pencil/core/io/formats/svg'
import {
  inspectMotionAdvancedChannels,
  motionVectorTopologyId,
  motionPathBoundaryProgresses,
  prepareMotionSamplingPlan,
  samplePreparedMotionPlan,
  type MotionAdvancedChannel,
  type MotionVisualState
} from '@open-pencil/motion'
import {
  type MotionEasing,
  type MotionChannels,
  type MotionKeyframe,
  type MotionSpec,
  type MotionTrack,
  type SceneNode,
  getMotionChannels,
  validateMotionSpec
} from '@open-pencil/scene-graph'

import type {
  IRMotion,
  IRMotionEasing,
  IRMotionKeyframe,
  IRMotionRenderTarget,
  IRMotionTrackComposition,
  IRMotionTrack
} from '../motion'
import type { IRWarning } from '../types'

export type MotionLoweringCache = Map<string, IRMotion>

const CSS_PAINT_TYPES = new Set([
  'SOLID',
  'GRADIENT_LINEAR',
  'GRADIENT_RADIAL',
  'GRADIENT_ANGULAR',
  'GRADIENT_DIAMOND'
])

/** Validate and lower a node's canonical MotionSpec into framework-neutral IR. */
export function collectNodeMotion(
  node: SceneNode,
  warnings: IRWarning[],
  targetKind: IRMotionRenderTarget['kind'] = node.type === 'TEXT' ? 'text' : 'box',
  cache?: MotionLoweringCache
): IRMotion | undefined {
  if (node.motion === undefined) return undefined

  let result: ReturnType<typeof validateMotionSpec>
  try {
    result = validateMotionSpec(node.motion as unknown)
  } catch (error) {
    warnings.push({
      code: 'motion-invalid',
      message: error instanceof Error ? error.message : 'Motion validation failed',
      nodeId: node.id
    })
    return undefined
  }
  if (!result.success) {
    warnings.push({
      code: 'motion-invalid',
      message: result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
      nodeId: node.id
    })
    return undefined
  }

  if (
    targetKind === 'vector' &&
    node.type === 'BOOLEAN_OPERATION' &&
    node.fillGeometry.length === 0
  ) {
    warnings.push({
      code: 'motion-boolean-result-unavailable',
      message:
        'Motion is disabled for this BOOLEAN_OPERATION because no resolved fillGeometry is available for headless compilation',
      nodeId: node.id
    })
    return undefined
  }

  warnChannelConflicts(result.value, node, warnings)
  if (node.boundVariables.opacity && motionUsesChannel(result.value, 'opacity')) {
    warnings.push({
      code: 'motion-opacity-binding-static',
      message:
        'Motion opacity uses the node static opacity at compile time; the runtime design-token binding is not sampled during animation',
      nodeId: node.id
    })
  }
  const compatibleSpec = lowerIncompatibleAdvancedMotion(result.value, node, targetKind, warnings)
  const spec = lowerUnsupportedVectorMotion(compatibleSpec, node, targetKind, warnings)
  const opacity = nodeOpacity(node)
  const target = motionRenderTarget(node, targetKind, spec)
  const cacheKey = cache ? JSON.stringify([spec, opacity, node.rotation, target]) : undefined
  const cached = cacheKey ? cache?.get(cacheKey) : undefined
  if (cached) return cached
  const motion = lowerMotion(spec, opacity, node.rotation, target, node)
  if (cacheKey) cache?.set(cacheKey, motion)
  return motion
}

function collectAdvancedCapabilityWarnings(
  spec: MotionSpec,
  node: SceneNode,
  unsupported: Set<MotionAdvancedChannel>,
  warnings: IRWarning[]
): void {
  const seen = new Set<string>()
  for (const track of spec.tracks) {
    for (const keyframe of track.keyframes) {
      for (const found of inspectMotionAdvancedChannels(node, keyframe)) {
        unsupported.add(found.channel)
        const key = `${found.channel}:${found.code}:${found.path}`
        if (seen.has(key)) continue
        seen.add(key)
        warnings.push({
          code: 'motion-advanced-channel-incompatible',
          message: `${found.channel} is disabled: ${found.message} (${found.path})`,
          nodeId: node.id
        })
      }
    }
  }
}

function motionHasPaintTarget(
  spec: MotionSpec,
  predicate: (target: NonNullable<MotionKeyframe['paints']>[number]) => boolean
): boolean {
  return spec.tracks.some((track) =>
    track.keyframes.some((keyframe) => keyframe.paints?.some(predicate))
  )
}

function hasGeneratedBackgroundStack(node: SceneNode): boolean {
  return node.fills.some(
    (fill) => fill.visible && fill.opacity > 0 && !CSS_PAINT_TYPES.has(fill.type)
  )
}

function hasUnsupportedIndexedFill(spec: MotionSpec, node: SceneNode): boolean {
  return motionHasPaintTarget(
    spec,
    (target) => target.kind === 'fill' && !CSS_PAINT_TYPES.has(node.fills[target.index]?.type ?? '')
  )
}

function hasUnsupportedProjectedEffect(
  node: SceneNode,
  targetKind: IRMotionRenderTarget['kind']
): boolean {
  if (targetKind === 'box') return false
  return node.effects.some(
    (effect) =>
      effect.visible && (effect.type === 'INNER_SHADOW' || effect.type === 'BACKGROUND_BLUR')
  )
}

function requiresStaticBackground(channels: MotionChannels, node: SceneNode): boolean {
  return Boolean(channels.paints || channels.gradientStops) && hasGeneratedBackgroundStack(node)
}

function requiresStaticIndexedFill(
  channels: MotionChannels,
  spec: MotionSpec,
  node: SceneNode
): boolean {
  return Boolean(channels.paints) && hasUnsupportedIndexedFill(spec, node)
}

function requiresStaticVectorMorph(
  channels: MotionChannels,
  node: SceneNode,
  targetKind: IRMotionRenderTarget['kind']
): boolean {
  if (!channels.vectorMorph) return false
  return targetKind !== 'vector' || node.fillGeometry.length > 0 || node.strokeGeometry.length > 0
}

function requiresStaticVectorGradient(
  channels: MotionChannels,
  targetKind: IRMotionRenderTarget['kind']
): boolean {
  return Boolean(channels.gradientStops) && targetKind === 'vector'
}

function requiresStaticIndexedStroke(channels: MotionChannels, spec: MotionSpec): boolean {
  return (
    Boolean(channels.paints) &&
    motionHasPaintTarget(spec, (paint) => paint.kind === 'stroke' && paint.index !== 0)
  )
}

function requiresStaticTextPaint(
  channels: MotionChannels,
  spec: MotionSpec,
  targetKind: IRMotionRenderTarget['kind']
): boolean {
  if (!channels.paints || targetKind !== 'text') return false
  return motionHasPaintTarget(spec, (paint) => paint.kind === 'fill' && paint.index !== 0)
}

function requiresStaticEffect(
  channels: MotionChannels,
  node: SceneNode,
  targetKind: IRMotionRenderTarget['kind']
): boolean {
  return Boolean(channels.effects) && hasUnsupportedProjectedEffect(node, targetKind)
}

function lowerIncompatibleAdvancedMotion(
  spec: MotionSpec,
  node: SceneNode,
  targetKind: IRMotionRenderTarget['kind'],
  warnings: IRWarning[]
): MotionSpec {
  if (spec.version !== 3) return spec
  const unsupported = new Set<MotionAdvancedChannel>()
  collectAdvancedCapabilityWarnings(spec, node, unsupported, warnings)
  const channels = getMotionChannels(spec.tracks.flatMap((track) => track.keyframes))
  if (requiresStaticBackground(channels, node)) {
    unsupported.add('paints')
    unsupported.add('gradientStops')
    warnings.push({
      code: 'motion-background-stack-static',
      message:
        'Structured paint motion cannot rebuild a generated background stack containing image/video/pattern/noise/custom layers; paints and gradient stops stay static',
      nodeId: node.id
    })
  }
  if (requiresStaticIndexedFill(channels, spec, node)) {
    unsupported.add('paints')
    warnings.push({
      code: 'motion-indexed-paint-static',
      message:
        'Indexed paint opacity on image/video/pattern/noise/custom fills cannot be isolated in generated CSS; indexed paints stay static',
      nodeId: node.id
    })
  }
  if (requiresStaticVectorMorph(channels, node, targetKind)) {
    unsupported.add('vectorMorph')
    warnings.push({
      code: 'motion-vector-morph-static',
      message:
        'vectorMorph requires a topology-owned inline SVG vector network without imported outline geometry; this target keeps authored geometry static',
      nodeId: node.id
    })
  }
  if (requiresStaticVectorGradient(channels, targetKind)) {
    unsupported.add('gradientStops')
    warnings.push({
      code: 'motion-vector-gradient-stops-static',
      message:
        'Indexed gradient-stop motion is not representable on generated inline SVG defs; this target keeps authored gradient stops static',
      nodeId: node.id
    })
  }
  if (requiresStaticIndexedStroke(channels, spec)) {
    unsupported.add('paints')
    warnings.push({
      code: 'motion-indexed-stroke-static',
      message:
        'Generated CSS/SVG exposes only the primary stroke resource; the requested indexed stroke motion stays static',
      nodeId: node.id
    })
  }
  if (requiresStaticTextPaint(channels, spec, targetKind)) {
    unsupported.add('paints')
    warnings.push({
      code: 'motion-text-paint-stack-static',
      message:
        'Generated text exposes only its primary fill; the requested indexed text paint motion stays static',
      nodeId: node.id
    })
  }
  if (requiresStaticEffect(channels, node, targetKind)) {
    unsupported.add('effects')
    warnings.push({
      code: 'motion-effect-projection-static',
      message:
        'Generated text/vector output cannot represent indexed inner-shadow or background-blur semantics; indexed effects stay static',
      nodeId: node.id
    })
  }
  if (node.isMask) {
    warnings.push({
      code: 'motion-mask-compile-unsupported',
      message:
        'Motion is retained on the generated mask element, but CSS mask grouping is unavailable; compiled output fails closed to normal-node rendering',
      nodeId: node.id
    })
  }
  if (unsupported.size === 0) return spec
  return {
    ...spec,
    tracks: spec.tracks.map((track) => ({
      ...track,
      keyframes: track.keyframes.map((keyframe) => stripAdvancedKeyframe(keyframe, unsupported))
    }))
  }
}

function stripAdvancedKeyframe(
  keyframe: MotionKeyframe,
  unsupported: ReadonlySet<MotionAdvancedChannel>
): MotionKeyframe {
  const {
    paints,
    gradientStops,
    effects,
    cornerRadii,
    textReveal,
    fontAxes,
    vectorMorph,
    ...rest
  } = keyframe
  return {
    ...rest,
    ...(!unsupported.has('paints') && paints ? { paints } : {}),
    ...(!unsupported.has('gradientStops') && gradientStops ? { gradientStops } : {}),
    ...(!unsupported.has('effects') && effects ? { effects } : {}),
    ...(!unsupported.has('cornerRadii') && cornerRadii ? { cornerRadii } : {}),
    ...(!unsupported.has('textReveal') && textReveal !== undefined ? { textReveal } : {}),
    ...(!unsupported.has('fontAxes') && fontAxes ? { fontAxes } : {}),
    ...(!unsupported.has('vectorMorph') && vectorMorph ? { vectorMorph } : {})
  }
}

function lowerUnsupportedVectorMotion(
  spec: MotionSpec,
  node: SceneNode,
  targetKind: IRMotionRenderTarget['kind'],
  warnings: IRWarning[]
): MotionSpec {
  const lacksCenterline =
    targetKind === 'vector' &&
    node.type === 'VECTOR' &&
    (node.vectorNetwork?.segments.length ?? 0) === 0
  if (!lacksCenterline) return spec
  const supportsFillPaint = node.fillGeometry.length > 0
  const supportsStrokePaint = node.strokeGeometry.length > 0
  const channels = getMotionChannels(spec.tracks.flatMap((track) => track.keyframes))
  const unsupportedStroke = [channels.strokeWidth ? 'strokeWidth' : '', channels.trim ? 'trim' : '']
    .filter(Boolean)
    .join(', ')
  const unsupportedPaint = [
    channels.fillColor && !supportsFillPaint ? 'fillColor' : '',
    channels.strokeColor && !supportsStrokePaint ? 'strokeColor' : ''
  ]
    .filter(Boolean)
    .join(', ')
  if (!unsupportedStroke && !unsupportedPaint) return spec
  if (unsupportedStroke) {
    warnings.push({
      code: 'motion-vector-outline-static',
      message: `Motion ${unsupportedStroke} requires vector centerline geometry; this VECTOR keeps those channels static`,
      nodeId: node.id
    })
  }
  if (unsupportedPaint) {
    warnings.push({
      code: 'motion-vector-paint-static',
      message: `Motion ${unsupportedPaint} requires matching drawable vector geometry; this VECTOR keeps those channels static`,
      nodeId: node.id
    })
  }
  return {
    ...spec,
    tracks: spec.tracks.map((track) => ({
      ...track,
      keyframes: track.keyframes.map((keyframe) =>
        stripUnsupportedVectorKeyframe(keyframe, !supportsFillPaint, !supportsStrokePaint)
      )
    }))
  }
}

function stripUnsupportedVectorKeyframe(
  keyframe: MotionKeyframe,
  stripFillPaint: boolean,
  stripStrokePaint: boolean
): MotionKeyframe {
  const {
    strokeWidth: _strokeWidth,
    trimStart: _trimStart,
    trimEnd: _trimEnd,
    trimOffset: _trimOffset,
    ...withoutCenterline
  } = keyframe
  if (stripFillPaint && stripStrokePaint) {
    const { fillColor: _fillColor, strokeColor: _strokeColor, ...supported } = withoutCenterline
    return supported
  }
  if (stripFillPaint) {
    const { fillColor: _fillColor, ...supported } = withoutCenterline
    return supported
  }
  if (stripStrokePaint) {
    const { strokeColor: _strokeColor, ...supported } = withoutCenterline
    return supported
  }
  return withoutCenterline
}

function lowerMotion(
  spec: MotionSpec,
  opacity: number,
  authoredRotation: number,
  target: IRMotionRenderTarget,
  sourceNode: SceneNode
): IRMotion {
  return {
    version: spec.version,
    tracks: spec.tracks.map((track, sourceIndex) =>
      lowerTrack(track, opacity, authoredRotation, target, spec.version, sourceIndex, sourceNode)
    ),
    reducedMotion: spec.reducedMotion ?? 'reduce',
    ...(spec.version >= 2 ? { target } : {}),
    ...(spec.version === 3 ? { authoredTransform: { opacity, rotate: authoredRotation } } : {})
  }
}

function motionRenderTarget(
  node: SceneNode,
  kind: IRMotionRenderTarget['kind'],
  spec: MotionSpec
): IRMotionRenderTarget {
  const target: IRMotionRenderTarget = { kind }
  addMotionTargetPaints(target, node, spec)
  addMotionTargetEffects(target, node)
  addMotionTargetAdvanced(target, node, spec)
  return target
}

function addMotionTargetAdvanced(
  target: IRMotionRenderTarget,
  node: SceneNode,
  spec: MotionSpec
): void {
  if (spec.version !== 3) return
  const channels = getMotionChannels(spec.tracks.flatMap((track) => track.keyframes))
  if (channels.paints || channels.gradientStops) {
    target.fills = node.fills.map((fill) => ({
      type:
        fill.type === 'SOLID' ||
        fill.type === 'GRADIENT_LINEAR' ||
        fill.type === 'GRADIENT_RADIAL' ||
        fill.type === 'GRADIENT_ANGULAR' ||
        fill.type === 'GRADIENT_DIAMOND'
          ? fill.type
          : 'UNSUPPORTED',
      color: { ...fill.color },
      opacity: fill.opacity,
      visible: fill.visible,
      ...(fill.gradientStops
        ? {
            gradientStops: fill.gradientStops.map((stop) => ({
              position: stop.position,
              color: { ...stop.color }
            }))
          }
        : {}),
      ...(fill.gradientTransform ? { gradientTransform: { ...fill.gradientTransform } } : {})
    }))
    target.strokes = node.strokes.map((stroke) => ({
      color: { ...stroke.color },
      opacity: stroke.opacity,
      visible: stroke.visible,
      weight: stroke.weight
    }))
  }
  if (channels.effects) {
    target.effects = node.effects.map((effect) => ({
      type: effect.type,
      color: { ...effect.color },
      x: effect.offset.x,
      y: effect.offset.y,
      radius: effect.radius,
      spread: effect.spread,
      visible: effect.visible
    }))
  }
  if (channels.cornerRadii) {
    target.cornerRadii = node.independentCorners
      ? {
          topLeft: node.topLeftRadius,
          topRight: node.topRightRadius,
          bottomRight: node.bottomRightRadius,
          bottomLeft: node.bottomLeftRadius
        }
      : {
          topLeft: node.cornerRadius,
          topRight: node.cornerRadius,
          bottomRight: node.cornerRadius,
          bottomLeft: node.cornerRadius
        }
  }
  if (channels.textReveal) target.text = node.text
  if (channels.fontAxes) {
    target.fontAxes = node.fontVariations.map((axis) => ({ tag: axis.axis, value: axis.value }))
  }
  if (channels.vectorMorph && node.vectorNetwork) {
    target.vectorMorph = {
      topologyId: motionVectorTopologyId(node) ?? '',
      pathCount: vectorNetworkToSVGPaths(node.vectorNetwork).length
    }
  }
}

function addMotionTargetPaints(
  target: IRMotionRenderTarget,
  node: SceneNode,
  spec: MotionSpec
): void {
  const channels = getMotionChannels(spec.tracks.flatMap((track) => track.keyframes))
  const needsFillPaint = channels.fillColor === true
  const needsStrokePaint = Boolean(channels.strokeColor || channels.strokeWidth || channels.trim)
  const visibleFills = node.fills.filter((candidate) => candidate.visible)
  const fill = node.fills.find((candidate) => candidate.visible && candidate.type === 'SOLID')
  const stroke = node.strokes.find((candidate) => candidate.visible)
  if (needsFillPaint && fill?.type === 'SOLID') {
    target.fillColor = { ...fill.color, a: fill.color.a * fill.opacity }
    target.fillOpacity = fill.opacity
    target.fillIndex = visibleFills.indexOf(fill)
  }
  if (needsStrokePaint && stroke) {
    target.strokeColor = { ...stroke.color, a: stroke.color.a * stroke.opacity }
    target.strokeOpacity = stroke.opacity
    target.strokeWidth = stroke.weight
  }
  if (isOutlineOnlyVectorStroke(node, target.kind, needsStrokePaint)) {
    target.vectorStrokeTarget = 'outline'
  }
}

function isOutlineOnlyVectorStroke(
  node: SceneNode,
  kind: IRMotionRenderTarget['kind'],
  needsStrokePaint: boolean
): boolean {
  return (
    needsStrokePaint &&
    kind === 'vector' &&
    node.type === 'VECTOR' &&
    node.strokeGeometry.length > 0 &&
    (node.vectorNetwork?.segments.length ?? 0) === 0
  )
}

function addMotionTargetEffects(target: IRMotionRenderTarget, node: SceneNode): void {
  const shadow = node.effects.find((effect) => effect.visible && effect.type === 'DROP_SHADOW')
  const blur = node.effects.find(
    (effect) =>
      effect.visible && (effect.type === 'LAYER_BLUR' || effect.type === 'FOREGROUND_BLUR')
  )
  target.shadowX = shadow?.offset.x ?? 0
  target.shadowY = shadow?.offset.y ?? 0
  target.shadowBlur = shadow?.radius ?? 0
  target.shadowSpread = shadow?.spread ?? 0
  target.shadowColor = { ...(shadow?.color ?? DEFAULT_SHADOW_COLOR) }
  if (blur) target.blur = blur.radius
  target.hasShadow = shadow !== undefined
}

function lowerTrack(
  track: MotionTrack,
  opacity: number,
  authoredRotation: number,
  target: IRMotionRenderTarget,
  version: MotionSpec['version'],
  sourceIndex: number,
  sourceNode: SceneNode
): IRMotionTrack {
  const channels = getMotionChannels(track.keyframes)
  if (track.path && channels.path) {
    return lowerSampledPathTrack(
      track,
      channels,
      opacity,
      authoredRotation,
      target,
      version,
      sourceIndex,
      sourceNode
    )
  }
  return {
    id: track.id,
    trigger: track.trigger,
    keyframes: track.keyframes.map((keyframe) =>
      lowerKeyframe(keyframe, channels, opacity, authoredRotation, target, version, sourceNode)
    ),
    timing: lowerTrackTiming(track, lowerEasing(track.timing.easing ?? 'ease')),
    exit: track.exit ?? 'reset',
    ...(version === 3 ? { composition: lowerTrackComposition(track, sourceIndex) } : {}),
    ...(track.path && track.path.version !== 2
      ? {
          path: {
            points: track.path.points.map((point) => ({ ...point })),
            ...(track.path.autoRotate === undefined ? {} : { autoRotate: track.path.autoRotate })
          }
        }
      : {})
  }
}

function lowerSampledPathTrack(
  track: MotionTrack,
  channels: MotionChannels,
  opacity: number,
  authoredRotation: number,
  target: IRMotionRenderTarget,
  version: MotionSpec['version'],
  sourceIndex: number,
  sourceNode: SceneNode
): IRMotionTrack {
  const durationMs = track.timing.durationMs
  const normalizedTrack: MotionTrack = {
    ...track,
    timing: {
      ...track.timing,
      delayMs: 0,
      iterations: 1,
      direction: 'normal',
      fill: 'both'
    }
  }
  const plan = prepareMotionSamplingPlan(
    // Path pre-sampling expands one isolated authored track. v3 composition is
    // applied later by the generated runtime; enabling it here would weight or
    // accumulate the samples twice.
    { version: version === 3 ? 2 : version, tracks: [normalizedTrack], reducedMotion: 'allow' },
    { selection: { mode: 'all' } }
  )
  const sampleOffsets = sampledPathOffsets(track, plan, durationMs)
  const sampledChannels: MotionChannels = {
    ...channels,
    translate: true,
    rotate: channels.rotate || track.path?.autoRotate === true,
    path: false
  }
  const keyframes = sampleOffsets.map((offset) =>
    lowerKeyframe(
      sampledMotionKeyframe(offset, samplePreparedMotionPlan(plan, durationMs * offset).visual),
      sampledChannels,
      opacity,
      authoredRotation,
      target,
      version,
      sourceNode
    )
  )
  return {
    id: track.id,
    trigger: track.trigger,
    keyframes,
    timing: lowerTrackTiming(track, 'linear'),
    exit: track.exit ?? 'reset',
    sampledPath: true,
    ...(version === 3 ? { composition: lowerTrackComposition(track, sourceIndex) } : {})
  }
}

function lowerTrackComposition(track: MotionTrack, sourceIndex: number): IRMotionTrackComposition {
  return {
    mode: track.composition?.mode ?? 'replace',
    weight: track.composition?.weight ?? 1,
    priority: track.composition?.priority ?? 0,
    sourceIndex
  }
}

function lowerTrackTiming(track: MotionTrack, easing: IRMotionEasing): IRMotionTrack['timing'] {
  return {
    durationMs: track.timing.durationMs,
    delayMs: track.timing.delayMs ?? 0,
    easing,
    iterations: track.timing.iterations ?? (track.trigger === 'loop' ? 'infinite' : 1),
    direction: track.timing.direction ?? 'normal',
    fill: track.timing.fill ?? 'both'
  }
}

function sampledMotionKeyframe(offset: number, visual: MotionVisualState): MotionKeyframe {
  return {
    offset,
    opacity: visual.opacity,
    x: visual.x,
    y: visual.y,
    scaleX: visual.scaleX,
    scaleY: visual.scaleY,
    rotate: visual.rotate,
    originX: visual.originX,
    originY: visual.originY,
    width: visual.width,
    height: visual.height,
    cornerRadius: visual.cornerRadius,
    fillColor: visual.fillColor ? { ...visual.fillColor } : undefined,
    strokeColor: visual.strokeColor ? { ...visual.strokeColor } : undefined,
    strokeWidth: visual.strokeWidth,
    blur: visual.blur,
    shadowX: visual.shadowX,
    shadowY: visual.shadowY,
    shadowBlur: visual.shadowBlur,
    shadowSpread: visual.shadowSpread,
    shadowColor: visual.shadowColor ? { ...visual.shadowColor } : undefined,
    trimStart: visual.trimStart,
    trimEnd: visual.trimEnd,
    trimOffset: visual.trimOffset,
    gap: visual.gap,
    rowGap: visual.rowGap,
    columnGap: visual.columnGap,
    paddingTop: visual.paddingTop,
    paddingRight: visual.paddingRight,
    paddingBottom: visual.paddingBottom,
    paddingLeft: visual.paddingLeft,
    paints: visual.paints?.map((target) => ({
      ...target,
      ...(target.color ? { color: { ...target.color } } : {})
    })),
    gradientStops: visual.gradientStops?.map((target) => ({
      ...target,
      color: { ...target.color }
    })),
    effects: visual.effects?.map((target) =>
      target.kind === 'shadow' ? { ...target, color: { ...target.color } } : { ...target }
    ),
    cornerRadii: visual.cornerRadii ? { ...visual.cornerRadii } : undefined,
    textReveal: visual.textReveal,
    fontAxes: visual.fontAxes?.map((axis) => ({ ...axis })),
    vectorMorph: visual.vectorMorph
      ? {
          topologyId: visual.vectorMorph.topologyId,
          points: visual.vectorMorph.points.map((point) => ({ ...point }))
        }
      : undefined
  }
}

function sampledPathOffsets(
  track: MotionTrack,
  plan: ReturnType<typeof prepareMotionSamplingPlan>,
  durationMs: number
): number[] {
  const offsets = new Set<number>([0, 1])
  for (const keyframe of track.keyframes) offsets.add(keyframe.offset)
  const coarse = Array.from({ length: 257 }, (_, index) => {
    const offset = index / 256
    return {
      offset,
      progress: samplePreparedMotionPlan(plan, durationMs * offset).visual.pathProgress
    }
  })
  const crossings: PathProgressCrossing[] = []
  for (const progress of track.path ? motionPathBoundaryProgresses(track.path) : []) {
    crossings.push(...findPathProgressOffsets(progress, coarse, plan, durationMs))
  }
  const uniqueCrossings = [
    ...new Map(
      crossings.map((crossing) => [`${crossing.beforeOffset}:${crossing.afterOffset}`, crossing])
    ).values()
  ].sort((a, b) => a.beforeOffset - b.beforeOffset)
  // Treat an auto-rotate corner as one atomic before/after pair. Adding every
  // incoming sample first used to exhaust the 257-frame cap and silently omit
  // the outgoing tangent for the latter half of a 128-point path.
  const crossingCost = track.path?.autoRotate ? 2 : 1
  const crossingBudget = Math.floor(Math.max(0, 257 - offsets.size) / crossingCost)
  const selectedCrossings = selectEvenly(uniqueCrossings, crossingBudget)
  for (const crossing of selectedCrossings) {
    offsets.add(crossing.beforeOffset)
    if (track.path?.autoRotate) offsets.add(crossing.afterOffset)
  }
  const guards = motionDiscontinuityGuards(track)
  const guardBudget = Math.max(0, 257 - offsets.size)
  for (const offset of selectEvenly(
    [...new Set(guards)].sort((a, b) => a - b),
    guardBudget
  )) {
    // Vertex pairs win priority under the hard 257-frame envelope. The
    // remaining budget is shared by discontinuous hold/steps guards, selected
    // deterministically across the full timeline.
    offsets.add(offset)
  }
  for (let index = 1; index < 64 && offsets.size < 257; index++) offsets.add(index / 64)
  return [...offsets].sort((a, b) => a - b).slice(0, 257)
}

interface PathProgressCrossing {
  beforeOffset: number
  afterOffset: number
}

function findPathProgressOffsets(
  target: number,
  coarse: readonly { offset: number; progress: number | undefined }[],
  plan: ReturnType<typeof prepareMotionSamplingPlan>,
  durationMs: number
): PathProgressCrossing[] {
  const result: PathProgressCrossing[] = []
  for (let index = 1; index < coarse.length; index++) {
    const { offset: fromOffset, progress: from } = coarse[index - 1]
    const { offset: toOffset, progress: to } = coarse[index]
    if (from === undefined || to === undefined) continue
    const fromIsTarget = Math.abs(from - target) <= 1e-9
    const toIsTarget = Math.abs(to - target) <= 1e-9
    // A hold/steps plateau at a path vertex can span hundreds of coarse
    // samples. It is one semantic stop, not hundreds of corner crossings.
    if (fromIsTarget && toIsTarget) continue
    if (fromIsTarget) {
      // Leave the plateau with an epsilon-separated outgoing tangent. The
      // authored/discontinuity offsets retain the instant the vertex was
      // entered; no duplicate pair is needed for that side.
      result.push(refinePathProgressExit(target, fromOffset, toOffset, plan, durationMs))
      continue
    }
    if (toIsTarget) continue
    if (target > Math.min(from, to) && target < Math.max(from, to)) {
      result.push(refinePathProgressCrossing(target, fromOffset, toOffset, from, plan, durationMs))
    }
  }
  return result
}

function refinePathProgressExit(
  target: number,
  initialLow: number,
  initialHigh: number,
  plan: ReturnType<typeof prepareMotionSamplingPlan>,
  durationMs: number
): PathProgressCrossing {
  let low = initialLow
  let high = initialHigh
  for (let iteration = 0; iteration < 20; iteration++) {
    const middle = (low + high) / 2
    const value = samplePreparedMotionPlan(plan, durationMs * middle).visual.pathProgress
    if (value !== undefined && Math.abs(value - target) <= 1e-9) low = middle
    else high = middle
  }
  return {
    beforeOffset: Math.round(low * 1_000_000_000_000) / 1_000_000_000_000,
    afterOffset: Math.round(high * 1_000_000_000_000) / 1_000_000_000_000
  }
}

function refinePathProgressCrossing(
  target: number,
  initialLow: number,
  initialHigh: number,
  initialLowValue: number,
  plan: ReturnType<typeof prepareMotionSamplingPlan>,
  durationMs: number
): PathProgressCrossing {
  let low = initialLow
  let high = initialHigh
  let lowValue = initialLowValue
  for (let iteration = 0; iteration < 20; iteration++) {
    const middle = (low + high) / 2
    const middleValue =
      samplePreparedMotionPlan(plan, durationMs * middle).visual.pathProgress ?? lowValue
    if (target > Math.min(lowValue, middleValue) && target < Math.max(lowValue, middleValue)) {
      high = middle
    } else if (Math.abs(middleValue - target) <= 1e-12) {
      low = middle
      high = Math.min(initialHigh, middle + 1e-9)
      break
    } else {
      low = middle
      lowValue = middleValue
    }
  }
  return {
    beforeOffset: Math.round(low * 1_000_000_000_000) / 1_000_000_000_000,
    afterOffset: Math.round(high * 1_000_000_000_000) / 1_000_000_000_000
  }
}

function motionDiscontinuityGuards(track: MotionTrack): number[] {
  const result: number[] = []
  for (let index = 0; index < track.keyframes.length - 1; index++) {
    const start = track.keyframes[index]
    const end = track.keyframes[index + 1]
    const easing = start.easing ?? track.timing.easing
    if (typeof easing !== 'object' || (easing.type !== 'hold' && easing.type !== 'steps')) {
      continue
    }
    const span = end.offset - start.offset
    if (span <= 0) continue
    const epsilon = Math.min(1e-7, span / 1_000_000)
    if (easing.type === 'hold') {
      result.push(Math.max(start.offset, end.offset - epsilon))
      continue
    }
    for (let step = 0; step <= easing.steps; step++) {
      const offset = start.offset + (span * step) / easing.steps
      if (easing.position === 'start') {
        if (offset < end.offset) {
          result.push(offset, Math.min(end.offset, offset + epsilon))
        }
      } else if (offset > start.offset) {
        result.push(Math.max(start.offset, offset - epsilon), offset)
      }
    }
  }
  return result
}

function selectEvenly<T>(values: readonly T[], count: number): T[] {
  if (count <= 0) return []
  if (values.length <= count) return [...values]
  if (count === 1) return [values[0]]
  return Array.from(
    { length: count },
    (_, index) => values[Math.round((index * (values.length - 1)) / (count - 1))]
  )
}

type MotionChannel = keyof MotionChannels

function warnChannelConflicts(spec: MotionSpec, node: SceneNode, warnings: IRWarning[]): void {
  if (spec.version === 3) return
  const owners = new Map<MotionChannel, string[]>()
  for (const track of spec.tracks) {
    const channels = getMotionChannels(track.keyframes)
    for (const channel of Object.keys(channels) as MotionChannel[]) {
      if (!channels[channel]) continue
      const trackIds = owners.get(channel) ?? []
      trackIds.push(track.id)
      owners.set(channel, trackIds)
    }
  }
  for (const [channel, trackIds] of owners) {
    if (trackIds.length < 2) continue
    warnings.push({
      code: 'motion-channel-conflict',
      message: `Motion tracks ${trackIds.join(', ')} all write ${channel}; source order is preserved and the later track wins`,
      nodeId: node.id
    })
  }
}

function motionUsesChannel(spec: MotionSpec, channel: MotionChannel): boolean {
  return spec.tracks.some((track) => getMotionChannels(track.keyframes)[channel])
}

function lowerKeyframe(
  keyframe: MotionKeyframe,
  channels: MotionChannels,
  opacity: number,
  authoredRotation: number,
  target: IRMotionRenderTarget,
  version: MotionSpec['version'],
  sourceNode: SceneNode
): IRMotionKeyframe {
  return {
    offset: keyframe.offset,
    ...lowerTransformKeyframe(keyframe, channels, opacity, authoredRotation, version),
    ...lowerGeometryKeyframe(keyframe, channels),
    ...lowerPaintKeyframe(keyframe, channels, target),
    ...lowerEffectKeyframe(keyframe, channels, target),
    ...lowerPathLayoutKeyframe(keyframe, channels),
    ...lowerAdvancedKeyframe(keyframe, sourceNode),
    ...(keyframe.easing ? { easing: lowerEasing(keyframe.easing) } : {})
  }
}

function lowerAdvancedKeyframe(
  keyframe: MotionKeyframe,
  sourceNode: SceneNode
): Partial<IRMotionKeyframe> {
  const result: Partial<IRMotionKeyframe> = {}
  if (keyframe.paints) {
    result.paints = keyframe.paints.map((target) => ({
      ...target,
      ...(target.color ? { color: { ...target.color } } : {})
    }))
  }
  if (keyframe.gradientStops) {
    result.gradientStops = keyframe.gradientStops.map((target) => ({
      ...target,
      color: { ...target.color }
    }))
  }
  if (keyframe.effects) {
    result.effects = keyframe.effects.map((target) =>
      target.kind === 'shadow' ? { ...target, color: { ...target.color } } : { ...target }
    )
  }
  if (keyframe.cornerRadii) result.cornerRadii = { ...keyframe.cornerRadii }
  if (keyframe.textReveal !== undefined) result.textReveal = keyframe.textReveal
  if (keyframe.fontAxes) result.fontAxes = keyframe.fontAxes.map((axis) => ({ ...axis }))
  if (keyframe.vectorMorph && sourceNode.vectorNetwork) {
    const network = {
      ...sourceNode.vectorNetwork,
      vertices: sourceNode.vectorNetwork.vertices.map((vertex, index) => ({
        ...vertex,
        ...keyframe.vectorMorph?.points[index]
      }))
    }
    result.vectorMorph = {
      topologyId: keyframe.vectorMorph.topologyId,
      points: keyframe.vectorMorph.points.map((point) => ({ ...point })),
      paths: vectorNetworkToSVGPaths(network)
    }
  }
  return result
}

function lowerTransformKeyframe(
  keyframe: MotionKeyframe,
  channels: MotionChannels,
  opacity: number,
  authoredRotation: number,
  version: MotionSpec['version']
): Partial<IRMotionKeyframe> {
  const result: Partial<IRMotionKeyframe> = {}
  if (channels.opacity) {
    result.opacity = version === 3 ? (keyframe.opacity ?? 1) : opacity * (keyframe.opacity ?? 1)
  }
  if (channels.translate) {
    result.x = keyframe.x ?? 0
    result.y = keyframe.y ?? 0
  }
  if (channels.scale) {
    result.scaleX = keyframe.scaleX ?? 1
    result.scaleY = keyframe.scaleY ?? 1
  }
  if (channels.rotate) {
    result.rotate =
      version === 3 ? (keyframe.rotate ?? 0) : authoredRotation + (keyframe.rotate ?? 0)
  }
  if (channels.origin) {
    result.originX = keyframe.originX ?? 0.5
    result.originY = keyframe.originY ?? 0.5
  }
  return result
}

function lowerGeometryKeyframe(
  keyframe: MotionKeyframe,
  channels: MotionChannels
): Partial<IRMotionKeyframe> {
  const result: Partial<IRMotionKeyframe> = {}
  if (channels.width) result.width = keyframe.width
  if (channels.height) result.height = keyframe.height
  if (channels.cornerRadius) result.cornerRadius = keyframe.cornerRadius
  return result
}

function lowerPaintKeyframe(
  keyframe: MotionKeyframe,
  channels: MotionChannels,
  target: IRMotionRenderTarget
): Partial<IRMotionKeyframe> {
  const result: Partial<IRMotionKeyframe> = {}
  if (channels.fillColor && keyframe.fillColor && target.fillOpacity !== undefined) {
    result.fillColor = {
      ...keyframe.fillColor,
      a: keyframe.fillColor.a * target.fillOpacity
    }
  }
  if (channels.strokeColor && keyframe.strokeColor && target.strokeOpacity !== undefined) {
    result.strokeColor = {
      ...keyframe.strokeColor,
      a: keyframe.strokeColor.a * target.strokeOpacity
    }
  }
  if (channels.strokeWidth) result.strokeWidth = keyframe.strokeWidth
  return result
}

function lowerEffectKeyframe(
  keyframe: MotionKeyframe,
  channels: MotionChannels,
  target: IRMotionRenderTarget
): Partial<IRMotionKeyframe> {
  const result: Partial<IRMotionKeyframe> = {}
  if (shouldLowerBlur(channels, target)) {
    result.blur = keyframe.blur ?? target.blur ?? 0
  }
  if (shouldLowerShadow(channels, target)) {
    result.shadowX = keyframe.shadowX ?? target.shadowX ?? 0
    result.shadowY = keyframe.shadowY ?? target.shadowY ?? 0
    result.shadowBlur = keyframe.shadowBlur ?? target.shadowBlur ?? 0
    result.shadowSpread = keyframe.shadowSpread ?? target.shadowSpread ?? 0
    result.shadowColor = {
      ...(keyframe.shadowColor ?? target.shadowColor ?? DEFAULT_SHADOW_COLOR)
    }
  }
  return result
}

function shouldLowerBlur(channels: MotionChannels, target: IRMotionRenderTarget): boolean {
  return Boolean(
    channels.blur || (target.kind === 'vector' && channels.shadow && target.blur !== undefined)
  )
}

function shouldLowerShadow(channels: MotionChannels, target: IRMotionRenderTarget): boolean {
  return Boolean(
    channels.shadow || (target.kind === 'vector' && channels.blur && target.hasShadow === true)
  )
}

function lowerPathLayoutKeyframe(
  keyframe: MotionKeyframe,
  channels: MotionChannels
): Partial<IRMotionKeyframe> {
  const result: Partial<IRMotionKeyframe> = {}
  if (channels.path) result.pathProgress = keyframe.pathProgress
  if (channels.trim) {
    if (keyframe.trimStart !== undefined) result.trimStart = keyframe.trimStart
    if (keyframe.trimEnd !== undefined) result.trimEnd = keyframe.trimEnd
    if (keyframe.trimOffset !== undefined) result.trimOffset = keyframe.trimOffset
  }
  if (channels.gap) result.gap = keyframe.gap
  if (channels.rowGap) result.rowGap = keyframe.rowGap
  if (channels.columnGap) result.columnGap = keyframe.columnGap
  if (channels.padding) {
    if (keyframe.paddingTop !== undefined) result.paddingTop = keyframe.paddingTop
    if (keyframe.paddingRight !== undefined) result.paddingRight = keyframe.paddingRight
    if (keyframe.paddingBottom !== undefined) result.paddingBottom = keyframe.paddingBottom
    if (keyframe.paddingLeft !== undefined) result.paddingLeft = keyframe.paddingLeft
  }
  return result
}

function lowerEasing(easing: MotionEasing): IRMotionEasing {
  return typeof easing === 'string' ? easing : { ...easing }
}

function nodeOpacity(node: SceneNode): number {
  const opacity =
    typeof node.opacity === 'number' && Number.isFinite(node.opacity) ? node.opacity : 1
  return Math.min(1, Math.max(0, opacity))
}
