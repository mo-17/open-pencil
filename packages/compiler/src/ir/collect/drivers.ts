import {
  inspectMotionDriverSourceBindings,
  type MotionDriverSourceGraph
} from '@open-pencil/motion'
import {
  motionDriverNodeReferences,
  validateMotionDriverSpec,
  type MotionDriverSpecV1,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import type { IRMotionDriverSpec } from '../drivers'
import type { IRWarning } from '../types'

export function collectMotionDriverNodeIds(graph: SceneGraph): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const node of graph.getAllNodes()) {
    if (!node.motionDrivers) continue
    ids.add(node.id)
    for (const id of motionDriverNodeReferences(node.motionDrivers)) {
      ids.add(id)
      const referenced = graph.getNode(id)
      if (referenced?.componentId) ids.add(referenced.componentId)
    }
  }
  return ids
}

function lowerMotionDrivers(spec: MotionDriverSpecV1): IRMotionDriverSpec {
  return {
    version: 1,
    drivers: spec.drivers.map((driver) => ({
      id: driver.id,
      source: { ...driver.source },
      target: { ...driver.target },
      mapping: {
        inputMin: driver.mapping.inputMin,
        inputMax: driver.mapping.inputMax,
        clamp: driver.mapping.clamp ?? true,
        reverse: driver.mapping.reverse ?? false,
        deadZone: driver.mapping.deadZone ?? 0
      }
    }))
  }
}

/** Validate and lower one owner-scoped continuous driver snapshot. */
export function collectNodeMotionDrivers(
  graph: MotionDriverSourceGraph,
  node: SceneNode,
  warnings: IRWarning[]
): IRMotionDriverSpec | undefined {
  if (!node.motionDrivers) return undefined
  let result: ReturnType<typeof validateMotionDriverSpec>
  try {
    result = validateMotionDriverSpec(node.motionDrivers)
  } catch (error) {
    warnings.push({
      code: 'motion-drivers-invalid',
      message: error instanceof Error ? error.message : 'Motion driver validation failed',
      nodeId: node.id
    })
    return undefined
  }
  if (!result.success) {
    warnings.push({
      code: 'motion-drivers-invalid',
      message: result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
      nodeId: node.id
    })
    return undefined
  }
  const sourceIssues = inspectMotionDriverSourceBindings(graph, node, result.value)
  if (sourceIssues.length > 0) {
    warnings.push({
      code: 'motion-drivers-invalid',
      message: sourceIssues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
      nodeId: node.id
    })
    return undefined
  }
  return lowerMotionDrivers(result.value)
}
