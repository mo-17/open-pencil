import {
  parseMotionSceneSpec,
  type MotionSceneCue,
  type MotionSceneSpec,
  type MotionSpec,
  type MotionTrack
} from '@open-pencil/scene-graph'

import type { MotionResolvedTarget } from './resolved-target'
import { prepareMotionSamplingPlan, samplePreparedMotionPlan } from './sampler'
import { preparedMotionPlanDuration } from './timing'
import type { MotionSample, PreparedMotionSamplingPlan } from './types'

export type MotionScenePlanIssueCode =
  | 'duplicate-cue-target'
  | 'motion-missing'
  | 'target-missing'
  | 'track-missing'

export interface MotionScenePlanIssue {
  readonly code: MotionScenePlanIssueCode
  readonly cueId: string
  readonly targetNodeId: string
  readonly trackId: string
  readonly message: string
}

export type MotionSceneResolvedTarget = MotionResolvedTarget

export type MotionSceneTargetResolver = (
  targetNodeId: string
) => MotionSceneResolvedTarget | undefined

export interface PrepareMotionSceneOptions {
  readonly prefersReducedMotion?: boolean
  /** Bound infinite tracks to one cycle for authoring previews and deterministic exports. */
  readonly infiniteAsSingleCycle?: boolean
  /** Keep the finite end sample visible without mutating the authored fill policy. */
  readonly holdFinalFrame?: boolean
}

export interface PreparedMotionSceneNodePlan {
  readonly nodeId: string
  readonly cueIds: readonly string[]
  readonly trackIds: readonly string[]
  readonly spec: MotionSpec
  readonly plan: PreparedMotionSamplingPlan
}

export interface PreparedMotionScenePlan {
  readonly sceneId: string
  readonly sequenceId: string
  readonly trigger: MotionSceneSpec['sequences'][number]['trigger']
  readonly durationMs: number
  readonly nodes: readonly PreparedMotionSceneNodePlan[]
  readonly issues: readonly MotionScenePlanIssue[]
}

export interface MotionSceneSample {
  readonly nodes: ReadonlyMap<string, MotionSample>
  readonly hasTracks: boolean
  readonly contributes: boolean
  readonly finished: boolean
}

interface ResolvedCue {
  readonly cue: MotionSceneCue
  readonly track: MotionTrack
  readonly sourceIndex: number
}

function issue(
  code: MotionScenePlanIssueCode,
  cue: MotionSceneCue,
  message: string
): MotionScenePlanIssue {
  return {
    code,
    cueId: cue.id,
    targetNodeId: cue.targetNodeId,
    trackId: cue.trackId,
    message
  }
}

function globalTrack(
  cue: MotionSceneCue,
  track: MotionTrack,
  options: PrepareMotionSceneOptions
): MotionTrack {
  const timeScale = cue.timeScale ?? 1
  const authoredIterations = track.timing.iterations
  const infinite =
    authoredIterations === 'infinite' ||
    (track.trigger === 'loop' && authoredIterations === undefined)
  const authoredFill = track.timing.fill ?? 'both'
  return {
    ...track,
    timing: {
      ...track.timing,
      durationMs: track.timing.durationMs / timeScale,
      delayMs: cue.startMs + (track.timing.delayMs ?? 0) / timeScale,
      ...(options.infiniteAsSingleCycle && infinite ? { iterations: 1 as const } : {}),
      ...(options.holdFinalFrame && authoredFill !== 'forwards' && authoredFill !== 'both'
        ? { fill: authoredFill === 'backwards' ? ('both' as const) : ('forwards' as const) }
        : {})
    }
  }
}

function prepareNodePlan(
  nodeId: string,
  motion: MotionSpec,
  cues: readonly ResolvedCue[],
  options: PrepareMotionSceneOptions
): PreparedMotionSceneNodePlan {
  const ordered = [...cues].sort((a, b) => a.sourceIndex - b.sourceIndex)
  const sceneMotion: MotionSpec = {
    version: motion.version,
    tracks: ordered.map(({ cue, track }) => globalTrack(cue, track, options)),
    ...(motion.reducedMotion ? { reducedMotion: motion.reducedMotion } : {})
  }
  return {
    nodeId,
    cueIds: ordered.map(({ cue }) => cue.id),
    trackIds: ordered.map(({ track }) => track.id),
    spec: sceneMotion,
    plan: prepareMotionSamplingPlan(sceneMotion, {
      selection: { mode: 'all' },
      prefersReducedMotion: options.prefersReducedMotion
    })
  }
}

/**
 * Resolve one page/frame sequence into immutable per-node sampling plans. Cue timing is folded into
 * track delay/duration, so the normal reference sampler remains the single composition authority.
 * Missing targets and tracks are inert and reported instead of being approximated.
 */
export function prepareMotionScenePlan(
  value: MotionSceneSpec,
  sequenceId: string,
  resolveTarget: MotionSceneTargetResolver,
  options: PrepareMotionSceneOptions = {}
): PreparedMotionScenePlan {
  const scene = parseMotionSceneSpec(value)
  const sequence = scene.sequences.find((candidate) => candidate.id === sequenceId)
  if (!sequence) throw new RangeError(`Unknown Motion scene sequence: ${sequenceId}`)

  const issues: MotionScenePlanIssue[] = []
  const grouped = new Map<
    string,
    { motion: MotionSpec; cues: ResolvedCue[]; seenTrackIds: Set<string> }
  >()
  for (const cue of sequence.cues) {
    if (cue.enabled === false) continue
    const resolved = resolveTarget(cue.targetNodeId)
    if (!resolved) {
      issues.push(
        issue('target-missing', cue, `Motion scene target not found: ${cue.targetNodeId}`)
      )
      continue
    }
    if (!resolved.motion) {
      issues.push(
        issue('motion-missing', cue, `Motion scene target has no MotionSpec: ${resolved.nodeId}`)
      )
      continue
    }
    const sourceIndex = resolved.motion.tracks.findIndex((track) => track.id === cue.trackId)
    const track = sourceIndex === -1 ? undefined : resolved.motion.tracks[sourceIndex]
    if (track === undefined) {
      issues.push(
        issue(
          'track-missing',
          cue,
          `Motion scene target ${resolved.nodeId} has no track ${cue.trackId}`
        )
      )
      continue
    }
    const entry = grouped.get(resolved.nodeId) ?? {
      motion: resolved.motion,
      cues: [],
      seenTrackIds: new Set<string>()
    }
    if (entry.seenTrackIds.has(track.id)) {
      issues.push(
        issue(
          'duplicate-cue-target',
          cue,
          `Motion scene sequence targets ${resolved.nodeId}/${track.id} more than once`
        )
      )
      continue
    }
    entry.seenTrackIds.add(track.id)
    entry.cues.push({ cue, track, sourceIndex })
    grouped.set(resolved.nodeId, entry)
  }

  const nodes = [...grouped.entries()].map(([nodeId, entry]) =>
    prepareNodePlan(nodeId, entry.motion, entry.cues, options)
  )
  return {
    sceneId: scene.id,
    sequenceId: sequence.id,
    trigger: sequence.trigger,
    durationMs: nodes.reduce(
      (duration, node) => Math.max(duration, preparedMotionPlanDuration(node.plan)),
      0
    ),
    nodes,
    issues
  }
}

/** Sample every resolved node at one shared scene time without mutating the graph. */
export function samplePreparedMotionScenePlan(
  plan: PreparedMotionScenePlan,
  elapsedMs: number
): MotionSceneSample {
  const nodes = new Map<string, MotionSample>()
  let contributes = false
  let finished = plan.nodes.length === 0
  if (plan.nodes.length > 0) finished = true
  for (const node of plan.nodes) {
    const sample = samplePreparedMotionPlan(node.plan, elapsedMs)
    nodes.set(node.nodeId, sample)
    contributes = contributes || sample.contributes
    finished = finished && sample.finished
  }
  return { nodes, hasTracks: plan.nodes.length > 0, contributes, finished }
}
