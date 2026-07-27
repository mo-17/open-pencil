import { validateMotionSpec, type MotionSpec, type MotionTrigger } from '@open-pencil/scene-graph'

import { sampleMotionSpec, type MotionVisualState } from '#core/motion'

import type { EditorContext, MotionPreviewState, MotionPreviewTarget } from './types'

function sampleTargets(
  targets: readonly MotionPreviewTarget[],
  elapsedMs: number,
  trigger: MotionTrigger,
  prefersReducedMotion: boolean
): Pick<MotionPreviewState, 'visuals' | 'finished'> {
  const visuals = new Map<string, MotionVisualState>()
  let finished = targets.length === 0
  if (targets.length > 0) finished = true
  for (const target of targets) {
    const sample = sampleMotionSpec(target.spec, elapsedMs, { trigger, prefersReducedMotion })
    visuals.set(target.nodeId, sample.visual)
    finished = finished && sample.finished
  }
  return { visuals, finished }
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
  function stopMotionPreview() {
    if (!ctx.state.motionPreview) return
    ctx.state.motionPreview = null
    ctx.requestRepaint()
  }

  function previewMotion(nodeIds: Iterable<string>, trigger: MotionTrigger = 'mount'): boolean {
    const prefersReducedMotion = ctx.prefersReducedMotion()
    const targets: MotionPreviewTarget[] = []
    const seen = new Set<string>()
    for (const nodeId of nodeIds) {
      if (seen.has(nodeId)) continue
      seen.add(nodeId)
      const motion = validatedMotion(ctx.graph.getNode(nodeId)?.motion)
      if (!motion) continue
      const initial = sampleMotionSpec(motion, 0, { trigger, prefersReducedMotion })
      if (initial.hasTracks) targets.push({ nodeId, spec: motion })
    }

    if (targets.length === 0) {
      stopMotionPreview()
      return false
    }

    const initial = sampleTargets(targets, 0, trigger, prefersReducedMotion)
    ctx.state.motionPreview = {
      targets,
      trigger,
      prefersReducedMotion,
      startedAtMs: null,
      visuals: initial.visuals,
      finished: initial.finished
    }
    ctx.requestRepaint()
    return true
  }

  function updateMotionPreviewFrame(timestampMs: number): boolean {
    const preview = ctx.state.motionPreview
    if (!preview) return false
    const timestamp = Number.isFinite(timestampMs) ? timestampMs : (preview.startedAtMs ?? 0)
    const startedAtMs = preview.startedAtMs ?? timestamp
    const elapsedMs = Math.max(0, timestamp - startedAtMs)
    const sampled = sampleTargets(
      preview.targets,
      elapsedMs,
      preview.trigger,
      preview.prefersReducedMotion
    )
    ctx.state.motionPreview = {
      ...preview,
      startedAtMs,
      visuals: sampled.visuals,
      finished: sampled.finished
    }
    return !sampled.finished
  }

  function isMotionPreviewActive(): boolean {
    return ctx.state.motionPreview != null
  }

  return {
    previewMotion,
    stopMotionPreview,
    updateMotionPreviewFrame,
    isMotionPreviewActive
  }
}
