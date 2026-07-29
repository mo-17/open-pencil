import { validateMotionSpec, type MotionSpec, type MotionTrigger } from '@open-pencil/scene-graph'

import {
  prepareMotionScenePlan,
  prepareMotionSamplingPlan,
  samplePreparedMotionPlan,
  type MotionVisualState
} from '#core/motion'

import type {
  EditorContext,
  MotionPreviewOptions,
  MotionPreviewSelection,
  MotionPreviewSpecsOptions,
  MotionPreviewSpecTarget,
  MotionPreviewState,
  MotionPreviewTarget,
  MotionScenePreviewResult
} from './types'

function sampleTargets(
  targets: readonly MotionPreviewTarget[],
  elapsedMs: number
): Pick<MotionPreviewState, 'visuals' | 'finished'> {
  const visuals = new Map<string, MotionVisualState>()
  let finished = targets.length === 0
  if (targets.length > 0) finished = true
  for (const target of targets) {
    const sample = samplePreparedMotionPlan(target.plan, elapsedMs)
    visuals.set(target.nodeId, sample.visual)
    finished = finished && sample.finished
  }
  return { visuals, finished }
}

/** Add end fill only to the ephemeral authoring sample. Runtime sampling and authored data stay intact. */
function withForwardFill(spec: MotionSpec): MotionSpec {
  return {
    ...spec,
    tracks: spec.tracks.map((track) => {
      const fill = track.timing.fill ?? 'both'
      if (fill === 'forwards' || fill === 'both') return track
      return {
        ...track,
        timing: { ...track.timing, fill: fill === 'backwards' ? 'both' : 'forwards' }
      }
    })
  }
}

function validatedMotion(value: unknown): MotionSpec | null {
  try {
    const result = validateMotionSpec(value)
    return result.success ? result.value : null
  } catch {
    return null
  }
}

export function createMotionPreviewActions(ctx: EditorContext) {
  let nextPreviewId = Math.max(1, (ctx.state.motionPreview?.id ?? 0) + 1)

  function replaceMotionPreview(preview: Omit<MotionPreviewState, 'id'>): MotionPreviewState {
    const next = { ...preview, id: nextPreviewId++ }
    ctx.state.motionPreview = next
    ctx.requestRepaint()
    return next
  }

  function collectSceneTargets(
    ownerNodeId: string,
    sequenceId: string,
    options: MotionPreviewOptions
  ) {
    const owner = ctx.graph.getNode(ownerNodeId)
    if (!owner?.motionScene) return undefined
    const plan = prepareMotionScenePlan(
      owner.motionScene,
      sequenceId,
      (targetNodeId) => {
        const target = ctx.graph.getNode(targetNodeId)
        if (!target || !ctx.graph.isDescendant(target.id, owner.id)) return undefined
        return { nodeId: target.id, motion: target.motion }
      },
      {
        prefersReducedMotion: ctx.prefersReducedMotion(),
        infiniteAsSingleCycle: options.infiniteAsSingleCycle,
        holdFinalFrame: options.holdFinalFrame
      }
    )
    return {
      plan,
      targets: plan.nodes.map(
        (node): MotionPreviewTarget => ({ nodeId: node.nodeId, spec: node.spec, plan: node.plan })
      )
    }
  }

  function collectSpecTargets(
    inputs: Iterable<MotionPreviewSpecTarget>,
    selection: MotionPreviewSelection,
    prefersReducedMotion: boolean,
    options: MotionPreviewOptions
  ): MotionPreviewTarget[] {
    const targets: MotionPreviewTarget[] = []
    const seen = new Set<string>()
    for (const input of inputs) {
      const nodeId = input.nodeId
      if (seen.has(nodeId) || !ctx.graph.getNode(nodeId)) continue
      const authoredMotion = validatedMotion(input.spec)
      if (!authoredMotion) continue
      seen.add(nodeId)
      const tracks = authoredMotion.tracks
        .filter(
          (track) =>
            (selection.mode === 'all' || track.trigger === selection.trigger) &&
            (!options.trackId || track.id === options.trackId)
        )
        .map((track) =>
          options.infiniteAsSingleCycle &&
          (track.timing.iterations === 'infinite' ||
            (track.trigger === 'loop' && track.timing.iterations === undefined))
            ? { ...track, timing: { ...track.timing, iterations: 1 as const } }
            : track
        )
      if (tracks.length === 0) continue
      const motion = { ...authoredMotion, tracks }
      const samplingMotion = options.holdFinalFrame ? withForwardFill(motion) : motion
      const plan = prepareMotionSamplingPlan(samplingMotion, {
        selection: { mode: 'all' },
        prefersReducedMotion
      })
      if (plan.tracks.length > 0) targets.push({ nodeId, spec: motion, plan })
    }
    return targets
  }

  function collectGraphTargets(
    nodeIds: Iterable<string>,
    selection: MotionPreviewSelection,
    prefersReducedMotion: boolean,
    options: MotionPreviewOptions
  ): MotionPreviewTarget[] {
    const inputs: MotionPreviewSpecTarget[] = []
    for (const nodeId of nodeIds) {
      inputs.push({ nodeId, spec: ctx.graph.getNode(nodeId)?.motion })
    }
    return collectSpecTargets(inputs, selection, prefersReducedMotion, options)
  }

  function stopMotionPreview(expectedPreviewId?: number): boolean {
    if (
      !ctx.state.motionPreview ||
      (expectedPreviewId !== undefined && ctx.state.motionPreview.id !== expectedPreviewId)
    ) {
      return false
    }
    ctx.state.motionPreview = null
    ctx.requestRepaint()
    return true
  }

  function previewMotion(
    nodeIds: Iterable<string>,
    trigger: MotionTrigger = 'mount',
    options: MotionPreviewOptions = {}
  ): boolean {
    const prefersReducedMotion = ctx.prefersReducedMotion()
    const selection: MotionPreviewSelection = { mode: 'trigger', trigger }
    const targets = collectGraphTargets(nodeIds, selection, prefersReducedMotion, options)

    if (targets.length === 0) {
      stopMotionPreview()
      return false
    }

    const initial = sampleTargets(targets, 0)
    replaceMotionPreview({
      targets,
      trigger,
      prefersReducedMotion,
      playing: true,
      startedAtMs: null,
      elapsedMs: 0,
      visuals: initial.visuals,
      finished: initial.finished
    })
    return true
  }

  /**
   * Preview caller-supplied MotionSpecs without writing them to the scene graph. Inputs pass through
   * the same strict parser as authored graph motion, so future/unsafe data is ignored rather than
   * reaching the sampler. Every track participates by default; callers may select one trigger.
   */
  function previewMotionSpecs(
    inputs: Iterable<MotionPreviewSpecTarget>,
    options: MotionPreviewSpecsOptions = {}
  ): boolean {
    const selection = options.selection ?? { mode: 'all' as const }
    const prefersReducedMotion = ctx.prefersReducedMotion()
    const targets = collectSpecTargets(inputs, selection, prefersReducedMotion, options)

    if (targets.length === 0) {
      stopMotionPreview()
      return false
    }

    const initial = sampleTargets(targets, 0)
    replaceMotionPreview({
      targets,
      trigger: selection.mode === 'all' ? 'all' : selection.trigger,
      prefersReducedMotion,
      playing: true,
      startedAtMs: null,
      elapsedMs: 0,
      visuals: initial.visuals,
      finished: initial.finished
    })
    return true
  }

  /**
   * Sample a timeline position without starting playback. The sampled visuals remain visible until
   * another preview/seek replaces them or stopMotionPreview() clears them.
   */
  function seekMotionPreview(
    nodeIds: Iterable<string>,
    trigger: MotionTrigger,
    elapsedMs: number,
    options: MotionPreviewOptions = {}
  ): boolean {
    const prefersReducedMotion = ctx.prefersReducedMotion()
    const targets = collectGraphTargets(
      nodeIds,
      { mode: 'trigger', trigger },
      prefersReducedMotion,
      options
    )
    if (targets.length === 0) {
      stopMotionPreview()
      return false
    }

    const normalizedElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
    const sampled = sampleTargets(targets, normalizedElapsedMs)
    replaceMotionPreview({
      targets,
      trigger,
      prefersReducedMotion,
      playing: false,
      startedAtMs: null,
      elapsedMs: normalizedElapsedMs,
      visuals: sampled.visuals,
      finished: sampled.finished
    })
    return true
  }

  function setMotionScenePreview(
    ownerNodeId: string,
    sequenceId: string,
    elapsedMs: number | null,
    options: MotionPreviewOptions
  ): MotionScenePreviewResult {
    const prepared = collectSceneTargets(ownerNodeId, sequenceId, options)
    if (!prepared || prepared.targets.length === 0) {
      stopMotionPreview()
      return {
        started: false,
        durationMs: prepared?.plan.durationMs ?? 0,
        issues: prepared?.plan.issues ?? []
      }
    }
    const playing = elapsedMs === null
    let normalizedElapsedMs = 0
    if (elapsedMs !== null && Number.isFinite(elapsedMs)) {
      normalizedElapsedMs = Math.max(0, elapsedMs)
    }
    const sampled = sampleTargets(prepared.targets, normalizedElapsedMs)
    const preview = replaceMotionPreview({
      targets: prepared.targets,
      trigger: prepared.plan.trigger === 'manual' ? 'all' : prepared.plan.trigger,
      prefersReducedMotion: ctx.prefersReducedMotion(),
      playing,
      startedAtMs: null,
      elapsedMs: normalizedElapsedMs,
      visuals: sampled.visuals,
      finished: sampled.finished
    })
    return {
      started: true,
      previewId: preview.id,
      durationMs: prepared.plan.durationMs,
      issues: prepared.plan.issues
    }
  }

  /** Preview a page/frame choreography without copying its referenced node-local keyframes. */
  function previewMotionScene(
    ownerNodeId: string,
    sequenceId: string,
    options: MotionPreviewOptions = {}
  ): MotionScenePreviewResult {
    return setMotionScenePreview(ownerNodeId, sequenceId, null, options)
  }

  /** Seek a page/frame choreography and keep the sampled visuals visible for timeline authoring. */
  function seekMotionScenePreview(
    ownerNodeId: string,
    sequenceId: string,
    elapsedMs: number,
    options: MotionPreviewOptions = {}
  ): MotionScenePreviewResult {
    return setMotionScenePreview(ownerNodeId, sequenceId, elapsedMs, options)
  }

  function updateMotionPreviewFrame(timestampMs: number): boolean {
    const preview = ctx.state.motionPreview
    if (!preview?.playing) return false
    const timestamp = Number.isFinite(timestampMs) ? timestampMs : (preview.startedAtMs ?? 0)
    const startedAtMs = preview.startedAtMs ?? timestamp
    const elapsedMs = Math.max(0, timestamp - startedAtMs)
    const sampled = sampleTargets(preview.targets, elapsedMs)
    ctx.state.motionPreview = {
      ...preview,
      startedAtMs,
      elapsedMs,
      visuals: sampled.visuals,
      finished: sampled.finished
    }
    return !sampled.finished
  }

  function isMotionPreviewActive(): boolean {
    return ctx.state.motionPreview?.playing === true
  }

  function hasMotionPreview(nodeId?: string, trackId?: string): boolean {
    const preview = ctx.state.motionPreview
    if (!preview) return false
    if (!nodeId && !trackId) return true
    return preview.targets.some(
      (target) =>
        (!nodeId || target.nodeId === nodeId) &&
        (!trackId || target.plan.tracks.some((track) => track.id === trackId))
    )
  }

  return {
    previewMotion,
    previewMotionSpecs,
    previewMotionScene,
    seekMotionPreview,
    seekMotionScenePreview,
    stopMotionPreview,
    updateMotionPreviewFrame,
    isMotionPreviewActive,
    hasMotionPreview
  }
}
