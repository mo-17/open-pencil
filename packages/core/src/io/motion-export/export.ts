import {
  validateMotionSpec,
  type MotionSpec,
  type MotionTrack,
  type SceneGraph
} from '@open-pencil/scene-graph'

import { computeContentBounds, headlessRenderNodes } from '#core/io/formats/raster'
import {
  prepareMotionSamplingPlan,
  prepareMotionScenePlan,
  preparedMotionPlanDuration,
  samplePreparedMotionPlan,
  samplePreparedMotionScenePlan,
  type MotionVisualState,
  type PreparedMotionSamplingPlan
} from '#core/motion'

import { motionExportUnavailableReason, resolveMotionAnimationEncoders } from './capabilities'
import { planMotionFrames } from './planner'
import {
  MOTION_EXPORT_LIMITS,
  MotionExportCancelledError,
  MotionExportCapabilityError,
  type ExportGraphMotionOptions,
  type MotionAnimationEncoder,
  type MotionAnimationExportResult,
  type MotionExportBounds,
  type MotionExportProgress,
  type MotionFrameRenderer,
  type MotionGraphExportPlan,
  type MotionGraphExportSource,
  type PlanGraphMotionExportOptions,
  type MotionPngSequenceManifest,
  type MotionRenderedFrame
} from './types'

interface PreparedGraphSource {
  readonly durationMs: number
  readonly exportNodeIds: readonly string[]
  readonly issues: readonly string[]
  sample(elapsedMs: number): ReadonlyMap<string, MotionVisualState>
}

interface AffineTransform {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly e: number
  readonly f: number
}

type MutableMotionExportBounds = {
  -readonly [Key in keyof MotionExportBounds]: MotionExportBounds[Key]
}

const IDENTITY_TRANSFORM: AffineTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new MotionExportCancelledError()
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function report(options: ExportGraphMotionOptions, progress: MotionExportProgress): void {
  options.onProgress?.(progress)
}

function finiteExportTrack(track: MotionTrack): MotionTrack {
  const infinite =
    track.timing.iterations === 'infinite' ||
    (track.trigger === 'loop' && track.timing.iterations === undefined)
  const fill = track.timing.fill ?? 'both'
  return {
    ...track,
    timing: {
      ...track.timing,
      ...(infinite ? { iterations: 1 as const } : {}),
      ...(fill === 'forwards' || fill === 'both'
        ? {}
        : { fill: fill === 'backwards' ? ('both' as const) : ('forwards' as const) })
    }
  }
}

function prepareNodeSource(
  graph: SceneGraph,
  pageId: string,
  source: Extract<MotionGraphExportSource, { kind: 'nodes' }>,
  prefersReducedMotion: boolean,
  disabled: boolean
): PreparedGraphSource {
  const nodeIds = [...new Set(source.nodeIds)]
  if (nodeIds.length === 0) throw new Error('Motion export requires at least one node')
  const page = graph.getNode(pageId)
  if (page?.type !== 'CANVAS') throw new Error(`Motion export page not found: ${pageId}`)

  const plans: Array<{ nodeId: string; plan: PreparedMotionSamplingPlan }> = []
  const issues: string[] = []
  for (const nodeId of nodeIds) {
    const node = graph.getNode(nodeId)
    if (!node || !graph.isDescendant(nodeId, pageId)) {
      throw new Error(`Motion export node ${nodeId} is not on page ${pageId}`)
    }
    const validated = validateMotionSpec(node.motion)
    if (!validated.success) {
      issues.push(
        `Node ${nodeId} has invalid or missing MotionSpec: ${validated.issues.map((item) => item.message).join('; ')}`
      )
      continue
    }
    const selectedTracks = validated.value.tracks
      .filter(
        (track) =>
          (source.trigger === undefined ||
            source.trigger === 'all' ||
            track.trigger === source.trigger) &&
          (source.trackId === undefined || track.id === source.trackId)
      )
      .map(finiteExportTrack)
    if (selectedTracks.length === 0) {
      issues.push(`Node ${nodeId} has no tracks matching the requested export selection`)
      continue
    }
    const motion: MotionSpec = { ...validated.value, tracks: selectedTracks }
    plans.push({
      nodeId,
      plan: prepareMotionSamplingPlan(motion, {
        selection: { mode: 'all' },
        prefersReducedMotion
      })
    })
  }
  if (plans.length === 0) throw new Error(issues[0] ?? 'No playable Motion tracks to export')

  return {
    durationMs: plans.reduce(
      (duration, item) => Math.max(duration, preparedMotionPlanDuration(item.plan)),
      0
    ),
    exportNodeIds: nodeIds,
    issues,
    sample(elapsedMs) {
      if (disabled) return new Map()
      const visuals = new Map<string, MotionVisualState>()
      for (const item of plans) {
        visuals.set(item.nodeId, samplePreparedMotionPlan(item.plan, elapsedMs).visual)
      }
      return visuals
    }
  }
}

function prepareSceneSource(
  graph: SceneGraph,
  pageId: string,
  source: Extract<MotionGraphExportSource, { kind: 'scene' }>,
  prefersReducedMotion: boolean,
  disabled: boolean
): PreparedGraphSource {
  const owner = graph.getNode(source.ownerNodeId)
  if (!owner || (owner.id !== pageId && !graph.isDescendant(owner.id, pageId))) {
    throw new Error(`Motion scene owner ${source.ownerNodeId} is not on page ${pageId}`)
  }
  if (!owner.motionScene) throw new Error(`Node ${owner.id} has no Motion scene`)
  const plan = prepareMotionScenePlan(
    owner.motionScene,
    source.sequenceId,
    (targetNodeId) => {
      const target = graph.getNode(targetNodeId)
      if (!target || !graph.isDescendant(target.id, owner.id)) return undefined
      return { nodeId: target.id, motion: target.motion }
    },
    { prefersReducedMotion, infiniteAsSingleCycle: true, holdFinalFrame: true }
  )
  if (plan.nodes.length === 0) {
    throw new Error(plan.issues[0]?.message ?? 'Motion scene has no playable targets')
  }
  return {
    durationMs: plan.durationMs,
    exportNodeIds: owner.type === 'CANVAS' ? owner.childIds : [owner.id],
    issues: plan.issues.map((issue) => issue.message),
    sample(elapsedMs) {
      if (disabled) return new Map()
      const visuals = new Map<string, MotionVisualState>()
      for (const [nodeId, sample] of samplePreparedMotionScenePlan(plan, elapsedMs).nodes) {
        visuals.set(nodeId, sample.visual)
      }
      return visuals
    }
  }
}

function prepareGraphSource(options: ExportGraphMotionOptions): PreparedGraphSource {
  const reducedMotion = options.reducedMotion ?? 'allow'
  const prefersReducedMotion = reducedMotion === 'reduce'
  const disabled = reducedMotion === 'disable'
  return options.source.kind === 'scene'
    ? prepareSceneSource(
        options.graph,
        options.pageId,
        options.source,
        prefersReducedMotion,
        disabled
      )
    : prepareNodeSource(
        options.graph,
        options.pageId,
        options.source,
        prefersReducedMotion,
        disabled
      )
}

function baseExportBounds(graph: SceneGraph, nodeIds: readonly string[]): MotionExportBounds {
  const bounds = computeContentBounds(graph, [...nodeIds])
  if (!bounds) throw new Error('Motion export target has no visible bounds')
  return bounds
}

function paddedBounds(bounds: MotionExportBounds, padding: number): MotionExportBounds {
  if (!Number.isFinite(padding) || padding < 0 || padding > MOTION_EXPORT_LIMITS.maxPadding) {
    throw new RangeError(`padding must be between 0 and ${MOTION_EXPORT_LIMITS.maxPadding}`)
  }
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding
  }
}

function multiplyTransforms(left: AffineTransform, right: AffineTransform): AffineTransform {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f
  }
}

function nodeMotionTransform(
  graph: SceneGraph,
  nodeId: string,
  visual: MotionVisualState
): AffineTransform {
  const node = graph.getNode(nodeId)
  if (!node) return IDENTITY_TRANSFORM
  const absolute = graph.getAbsolutePosition(nodeId)
  const width = visual.width ?? node.width
  const height = visual.height ?? node.height
  const originX = absolute.x + width * (visual.originX ?? 0.5)
  const originY = absolute.y + height * (visual.originY ?? 0.5)
  const radians = (visual.rotate * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const a = cosine * visual.scaleX
  const b = sine * visual.scaleX
  const c = -sine * visual.scaleY
  const d = cosine * visual.scaleY
  return {
    a,
    b,
    c,
    d,
    e: originX + visual.x - a * originX - c * originY,
    f: originY + visual.y - b * originX - d * originY
  }
}

function transformedPoint(transform: AffineTransform, x: number, y: number) {
  return {
    x: transform.a * x + transform.c * y + transform.e,
    y: transform.b * x + transform.d * y + transform.f
  }
}

function includeTransformedBounds(
  target: MutableMotionExportBounds,
  source: MotionExportBounds,
  transform: AffineTransform
): void {
  const points = [
    transformedPoint(transform, source.minX, source.minY),
    transformedPoint(transform, source.maxX, source.minY),
    transformedPoint(transform, source.maxX, source.maxY),
    transformedPoint(transform, source.minX, source.maxY)
  ]
  for (const point of points) {
    target.minX = Math.min(target.minX, point.x)
    target.minY = Math.min(target.minY, point.y)
    target.maxX = Math.max(target.maxX, point.x)
    target.maxY = Math.max(target.maxY, point.y)
  }
}

interface MotionEnvelopeTarget {
  readonly nodeId: string
  readonly staticBounds: MotionExportBounds
  readonly chain: readonly string[]
}

function motionEnvelopeTargets(
  graph: SceneGraph,
  visuals: readonly ReadonlyMap<string, MotionVisualState>[]
): MotionEnvelopeTarget[] {
  const nodeIds = new Set<string>()
  for (const frame of visuals) for (const nodeId of frame.keys()) nodeIds.add(nodeId)
  const targets: MotionEnvelopeTarget[] = []
  for (const nodeId of nodeIds) {
    const staticBounds = computeContentBounds(graph, [nodeId])
    const node = graph.getNode(nodeId)
    if (!staticBounds || !node) continue
    const chain: string[] = []
    let current = node
    while (current.parentId) {
      chain.push(current.id)
      const parent = graph.getNode(current.parentId)
      if (!parent || parent.type === 'CANVAS') break
      current = parent
    }
    targets.push({ nodeId, staticBounds, chain: chain.reverse() })
  }
  return targets
}

async function computeMotionEnvelope(
  graph: SceneGraph,
  base: MotionExportBounds,
  visualFrames: readonly ReadonlyMap<string, MotionVisualState>[],
  signal?: AbortSignal
): Promise<MotionExportBounds> {
  const envelope = { ...base }
  const targets = motionEnvelopeTargets(graph, visualFrames)
  for (let frameIndex = 0; frameIndex < visualFrames.length; frameIndex++) {
    if (frameIndex > 0 && frameIndex % 64 === 0) await yieldToHost()
    throwIfCancelled(signal)
    const visuals = visualFrames[frameIndex]
    for (const target of targets) {
      const node = graph.getNode(target.nodeId)
      const targetVisual = visuals.get(target.nodeId)
      let staticBounds = target.staticBounds
      if (node && targetVisual) {
        const absolute = graph.getAbsolutePosition(node.id)
        const blurExtent = Math.max(0, targetVisual.blur ?? 0, targetVisual.shadowBlur ?? 0)
        const spreadExtent = Math.abs(targetVisual.shadowSpread ?? 0)
        const strokeExtent = Math.max(0, targetVisual.strokeWidth ?? 0) / 2
        const effectExtent = blurExtent + spreadExtent + strokeExtent
        const shadowX = targetVisual.shadowX ?? 0
        const shadowY = targetVisual.shadowY ?? 0
        staticBounds = {
          minX: Math.min(staticBounds.minX, absolute.x) - effectExtent - Math.max(0, -shadowX),
          minY: Math.min(staticBounds.minY, absolute.y) - effectExtent - Math.max(0, -shadowY),
          maxX:
            Math.max(staticBounds.maxX, absolute.x + (targetVisual.width ?? node.width)) +
            effectExtent +
            Math.max(0, shadowX),
          maxY:
            Math.max(staticBounds.maxY, absolute.y + (targetVisual.height ?? node.height)) +
            effectExtent +
            Math.max(0, shadowY)
        }
      }
      let transform = IDENTITY_TRANSFORM
      for (const nodeId of target.chain) {
        const visual = visuals.get(nodeId)
        if (visual)
          transform = multiplyTransforms(transform, nodeMotionTransform(graph, nodeId, visual))
      }
      includeTransformedBounds(envelope, staticBounds, transform)
    }
  }
  return envelope
}

interface PreparedMotionGraphExport extends MotionGraphExportPlan {
  readonly visualFrames: readonly ReadonlyMap<string, MotionVisualState>[]
}

async function prepareMotionGraphExport(
  options: PlanGraphMotionExportOptions
): Promise<PreparedMotionGraphExport> {
  throwIfCancelled(options.signal)
  const prepared = prepareGraphSource(options)
  const durationMs = options.durationMs ?? prepared.durationMs
  if (durationMs <= 0) throw new Error('Motion export duration must be greater than zero')
  const baseBounds = baseExportBounds(options.graph, prepared.exportNodeIds)
  const provisionalPlan = planMotionFrames({
    durationMs,
    fps: options.fps,
    loops: options.loops,
    scale: options.scale,
    width: baseBounds.maxX - baseBounds.minX,
    height: baseBounds.maxY - baseBounds.minY
  })
  const visualFrames: ReadonlyMap<string, MotionVisualState>[] = []
  for (const frame of provisionalPlan.frames) {
    if (frame.index > 0 && frame.index % 64 === 0) await yieldToHost()
    throwIfCancelled(options.signal)
    visualFrames.push(prepared.sample(frame.localTimeUs / 1_000))
  }
  const bounds = paddedBounds(
    await computeMotionEnvelope(options.graph, baseBounds, visualFrames, options.signal),
    options.padding ?? 0
  )
  const plan = planMotionFrames({
    durationMs,
    fps: provisionalPlan.fps,
    loops: provisionalPlan.loops,
    scale: provisionalPlan.scale,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY
  })
  return {
    plan,
    bounds,
    nodeIds: prepared.exportNodeIds,
    issues: prepared.issues,
    reducedMotion: options.reducedMotion ?? 'allow',
    visualFrames
  }
}

/** Plan the exact animated export envelope without rendering or encoding frames. */
export async function planGraphMotionExport(
  options: PlanGraphMotionExportOptions
): Promise<MotionGraphExportPlan> {
  const prepared = await prepareMotionGraphExport(options)
  return {
    plan: prepared.plan,
    bounds: prepared.bounds,
    nodeIds: prepared.nodeIds,
    issues: prepared.issues,
    reducedMotion: prepared.reducedMotion
  }
}

const defaultRenderFrame: MotionFrameRenderer = async ({
  graph,
  pageId,
  nodeIds,
  scale,
  bounds,
  visuals,
  frame,
  generatedEffectMode
}) =>
  headlessRenderNodes(graph, pageId, Array.from(nodeIds), {
    format: 'PNG',
    scale,
    bounds,
    motionVisualStates: visuals,
    generatedEffectTimeMs: frame.localTimeUs / 1_000,
    generatedEffectMode
  })

function hasPrefix(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  return expected.every((value, index) => bytes[offset + index] === value)
}

function assertEncodedSignature(encoder: MotionAnimationEncoder, bytes: Uint8Array): void {
  let valid = false
  if (encoder.format === 'gif') valid = hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38])
  else if (encoder.format === 'webm') valid = hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])
  else valid = bytes.length >= 12 && hasPrefix(bytes, [0x66, 0x74, 0x79, 0x70], 4)
  if (!valid) {
    throw new Error(`${encoder.format} encoder returned data without the expected file signature`)
  }
}

export function createMotionPngSequenceManifest(
  plan: ReturnType<typeof planMotionFrames>,
  frames: readonly MotionRenderedFrame[]
): MotionPngSequenceManifest {
  return {
    version: 1,
    format: 'png-sequence',
    fps: plan.fps,
    timebase: plan.timebase,
    sourceDurationUs: plan.sourceDurationUs,
    totalDurationUs: plan.totalDurationUs,
    loops: plan.loops,
    width: plan.width,
    height: plan.height,
    pixelWidth: plan.pixelWidth,
    pixelHeight: plan.pixelHeight,
    frameCount: plan.frameCount,
    frames: frames.map((frame) => ({
      index: frame.index,
      file: frame.fileName,
      timestampUs: frame.timestampUs,
      durationUs: frame.durationUs,
      loopIndex: frame.loopIndex,
      localTimeUs: frame.localTimeUs,
      byteLength: frame.byteLength
    }))
  }
}

/** Render an authored node/scene timeline against one fixed canvas at an exact integer timebase. */
export async function exportGraphMotion(
  options: ExportGraphMotionOptions
): Promise<MotionAnimationExportResult> {
  throwIfCancelled(options.signal)
  const format = options.format ?? 'png-sequence'
  const encoder =
    format === 'png-sequence'
      ? undefined
      : resolveMotionAnimationEncoders(options.encoders).find(
          (candidate) => candidate.format === format
        )
  if (format !== 'png-sequence' && !encoder) {
    throw new MotionExportCapabilityError(format, motionExportUnavailableReason(format))
  }
  report(options, { phase: 'prepare', completed: 0, total: 1 })
  const prepared = await prepareMotionGraphExport(options)
  const { bounds, plan, visualFrames } = prepared
  report(options, { phase: 'prepare', completed: 1, total: 1 })

  const renderFrame = options.renderFrame ?? defaultRenderFrame
  const frames: MotionRenderedFrame[] = []
  report(options, { phase: 'render', completed: 0, total: plan.frameCount })
  for (const frame of plan.frames) {
    throwIfCancelled(options.signal)
    const visuals = visualFrames[frame.index]
    const bytes = await renderFrame({
      graph: options.graph,
      pageId: options.pageId,
      nodeIds: prepared.nodeIds,
      scale: plan.scale,
      bounds,
      visuals,
      frame,
      generatedEffectMode: prepared.reducedMotion,
      signal: options.signal
    })
    throwIfCancelled(options.signal)
    if (!bytes || bytes.length === 0) {
      throw new Error(`Motion frame ${frame.index} did not produce PNG data`)
    }
    if (!hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      throw new Error(`Motion frame ${frame.index} is not valid PNG data`)
    }
    frames.push({ ...frame, mimeType: 'image/png', bytes, byteLength: bytes.length })
    report(options, {
      phase: 'render',
      completed: frame.index + 1,
      total: plan.frameCount,
      frameIndex: frame.index
    })
  }

  const baseResult = {
    plan,
    source: options.source,
    reducedMotion: prepared.reducedMotion,
    issues: prepared.issues
  } as const
  if (format === 'png-sequence') {
    return {
      ...baseResult,
      format,
      mimeType: 'image/png',
      frames,
      manifest: createMotionPngSequenceManifest(plan, frames)
    }
  }
  if (!encoder) {
    throw new MotionExportCapabilityError(format, motionExportUnavailableReason(format))
  }

  report(options, { phase: 'encode', completed: 0, total: 1 })
  throwIfCancelled(options.signal)
  const bytes = await encoder.encode({
    plan,
    frames,
    signal: options.signal,
    onProgress: options.onProgress
  })
  throwIfCancelled(options.signal)
  assertEncodedSignature(encoder, bytes)
  report(options, { phase: 'encode', completed: 1, total: 1 })
  return {
    ...baseResult,
    format,
    mimeType: encoder.mimeType,
    extension: encoder.extension,
    bytes,
    byteLength: bytes.length,
    encoder: encoder.capability,
    alpha: encoder.alpha,
    determinism: encoder.determinism
  }
}
