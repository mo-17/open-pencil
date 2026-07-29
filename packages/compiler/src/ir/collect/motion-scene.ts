import {
  prepareMotionScenePlan,
  type MotionScenePlanIssue,
  type PreparedMotionScenePlan
} from '@open-pencil/core/motion'
import {
  type MotionSceneSpec,
  type SceneGraph,
  type SceneNode,
  validateMotionSceneSpec,
  validateMotionSpec
} from '@open-pencil/scene-graph'

import type { IRMotionScene, IRMotionSceneSequence } from '../motion'
import type { IRWarning } from '../types'

/**
 * Validate and lower one page-owned choreography without leaking SceneGraph types into adapters.
 * Invalid targets/tracks are omitted cue-by-cue, matching the core scene planner's fail-closed
 * behavior while preserving every independently valid cue in authored order.
 */
export function collectMotionScene(
  graph: SceneGraph,
  owner: SceneNode,
  warnings: IRWarning[]
): IRMotionScene | undefined {
  if (owner.motionScene === undefined) return undefined
  const validated = validateScene(owner, warnings)
  if (!validated) return undefined

  const sequences = validated.sequences.map((sequence) =>
    collectSequence(graph, owner, validated, sequence.id, warnings)
  )
  return { id: validated.id, sequences }
}

function validateScene(owner: SceneNode, warnings: IRWarning[]): MotionSceneSpec | undefined {
  let result: ReturnType<typeof validateMotionSceneSpec>
  try {
    result = validateMotionSceneSpec(owner.motionScene as unknown)
  } catch (error) {
    warnings.push({
      code: 'motion-scene-invalid',
      message: error instanceof Error ? error.message : 'Motion scene validation failed',
      nodeId: owner.id
    })
    return undefined
  }
  if (result.success) return result.value
  warnings.push({
    code: 'motion-scene-invalid',
    message: result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
    nodeId: owner.id
  })
  return undefined
}

function collectSequence(
  graph: SceneGraph,
  owner: SceneNode,
  scene: MotionSceneSpec,
  sequenceId: string,
  warnings: IRWarning[]
): IRMotionSceneSequence {
  const authored = scene.sequences.find((sequence) => sequence.id === sequenceId)
  if (!authored) throw new RangeError(`Unknown Motion scene sequence: ${sequenceId}`)
  let plan: PreparedMotionScenePlan
  try {
    plan = prepareMotionScenePlan(scene, sequenceId, (targetNodeId) => {
      const target = graph.getNode(targetNodeId)
      if (!target || !graph.isDescendant(target.id, owner.id)) return undefined
      const motion = validatedMotion(target)
      return { nodeId: target.id, motion }
    })
  } catch (error) {
    warnings.push({
      code: 'motion-scene-sequence-invalid',
      message:
        error instanceof Error
          ? `Motion scene sequence ${sequenceId}: ${error.message}`
          : `Motion scene sequence ${sequenceId} could not be prepared`,
      nodeId: owner.id
    })
    return {
      id: authored.id,
      trigger: authored.trigger,
      cues: [],
      durationMs: 0
    }
  }

  for (const issue of plan.issues) warnings.push(planWarning(owner.id, issue))
  const validCueIds = new Set(plan.nodes.flatMap((node) => node.cueIds))
  return {
    id: authored.id,
    trigger: authored.trigger,
    cues: authored.cues.flatMap((cue) =>
      cue.enabled === false || !validCueIds.has(cue.id)
        ? []
        : [
            {
              id: cue.id,
              targetNodeId: cue.targetNodeId,
              trackId: cue.trackId,
              startMs: cue.startMs,
              timeScale: cue.timeScale ?? 1
            }
          ]
    ),
    durationMs: plan.durationMs
  }
}

function validatedMotion(node: SceneNode): SceneNode['motion'] {
  if (node.motion === undefined) return undefined
  try {
    const result = validateMotionSpec(node.motion as unknown)
    return result.success ? result.value : undefined
  } catch {
    return undefined
  }
}

function planWarning(ownerId: string, issue: MotionScenePlanIssue): IRWarning {
  return {
    code: `motion-scene-${issue.code}`,
    message: issue.message,
    nodeId: ownerId
  }
}
