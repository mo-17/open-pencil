import { inspectMotionNodeCapabilities } from '@open-pencil/core/motion'
import { cloneMotionSpec, type MotionSpec, type SceneNode } from '@open-pencil/scene-graph'

import { printError } from '#cli/format'

export function printMotionJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

export async function runMotionCommandSafely(task: () => Promise<void>): Promise<void> {
  try {
    await task()
  } catch (error) {
    printError(error)
    process.exitCode = 1
  }
}

export function motionNodeChanges(
  node: SceneNode,
  motion: SceneNode['motion']
): Partial<SceneNode> {
  const nextMotion = motion ? cloneMotionSpec(motion) : undefined
  const changes: Partial<SceneNode> = { motion: nextMotion }
  if (node.type === 'INSTANCE') {
    return {
      ...changes,
      overrides: {
        ...node.overrides,
        motion: nextMotion === undefined ? null : cloneMotionSpec(nextMotion)
      }
    }
  }
  return changes
}

export function assertMotionTargetsCompatible(
  targets: readonly { node: SceneNode | undefined; motion: MotionSpec }[]
): void {
  const issues = targets.flatMap(({ node, motion }) =>
    node
      ? inspectMotionNodeCapabilities(node, motion).map(
          ({ path, message }) =>
            `MotionSpec is incompatible with node ${node.id}: ${path}: ${message}`
        )
      : []
  )
  if (issues.length > 0) throw new Error(issues.join('; '))
}
