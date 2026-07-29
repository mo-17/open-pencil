import {
  inspectMotionDriverSourceBindings,
  prepareMotionDriverTarget,
  type MotionDriverSourceGraph
} from '@open-pencil/core/motion'
import {
  cloneMotionDriverSpec,
  parseMotionDriverSpec,
  type MotionDriver,
  type MotionDriverSource,
  type MotionDriverSpecV1,
  type SceneNode
} from '@open-pencil/scene-graph'

import type { MotionMutationEditor } from '../motion'

export interface MotionDriverGraphReader extends MotionDriverSourceGraph {
  getChildren(id: string): SceneNode[]
  isDescendant(id: string, ancestorId: string): boolean
}

export type MotionDriverMutationEditor = Omit<MotionMutationEditor, 'graph'> & {
  graph: MotionDriverGraphReader
}

export interface MotionDriverTrackOption {
  readonly key: string
  readonly nodeId: string
  readonly nodeName: string
  readonly trackId: string
  readonly trackName: string
  readonly durationMs: number
}

export function motionDriverTrackKey(nodeId: string, trackId: string): string {
  return JSON.stringify([nodeId, trackId])
}

export function parseMotionDriverTrackKey(key: string): { nodeId: string; trackId: string } {
  const value: unknown = JSON.parse(key)
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'string' ||
    typeof value[1] !== 'string'
  ) {
    throw new RangeError('Invalid Motion driver track key')
  }
  return { nodeId: value[0], trackId: value[1] }
}

export function isMotionDriverOwner(node: SceneNode | undefined): node is SceneNode {
  return node?.type === 'CANVAS' || node?.type === 'FRAME'
}

/** Owner plus descendants, in stable document order. */
export function collectMotionDriverNodes(
  graph: Pick<MotionDriverGraphReader, 'getNode' | 'getChildren'>,
  ownerNodeId: string
): SceneNode[] {
  const owner = graph.getNode(ownerNodeId)
  if (!owner) return []
  const nodes: SceneNode[] = [owner]
  for (const node of nodes) nodes.push(...graph.getChildren(node.id))
  return nodes
}

/** Enumerate only tracks accepted by the reference direct-progress sampler. */
export function collectMotionDriverTracks(
  graph: Pick<MotionDriverGraphReader, 'getNode' | 'getChildren'>,
  ownerNodeId: string
): MotionDriverTrackOption[] {
  return collectMotionDriverNodes(graph, ownerNodeId).flatMap((node) =>
    (node.motion?.tracks ?? []).flatMap((track) => {
      const driver: MotionDriver = {
        id: 'authoring-check',
        source: { kind: 'pageState', stateId: 'authoring-check' },
        target: { targetNodeId: node.id, trackId: track.id },
        mapping: { inputMin: 0, inputMax: 1 }
      }
      const preparation = prepareMotionDriverTarget(driver, () => ({
        nodeId: node.id,
        motion: node.motion
      }))
      return preparation.success
        ? [
            {
              key: motionDriverTrackKey(node.id, track.id),
              nodeId: node.id,
              nodeName: node.name,
              trackId: track.id,
              trackName: track.name ?? track.id,
              durationMs: preparation.target.durationMs
            }
          ]
        : []
    })
  )
}

function sourceNodeIds(source: MotionDriverSource): string[] {
  if (source.kind === 'drag') return [source.handleNodeId]
  if (source.kind === 'visibility') return [source.sourceNodeId]
  if ((source.kind === 'scroll' || source.kind === 'pointer') && source.sourceNodeId) {
    return [source.sourceNodeId]
  }
  return []
}

function belongsToOwner(graph: MotionDriverGraphReader, ownerId: string, nodeId: string): boolean {
  return nodeId === ownerId || graph.isDescendant(nodeId, ownerId)
}

/** Validate graph references in addition to the portable schema before authoring. */
export function validateMotionDriverReferences(
  graph: MotionDriverGraphReader,
  ownerNodeId: string,
  value: MotionDriverSpecV1
): MotionDriverSpecV1 {
  const owner = graph.getNode(ownerNodeId)
  if (!isMotionDriverOwner(owner)) {
    throw new RangeError('Motion drivers may only be attached to a page or frame')
  }
  const spec = parseMotionDriverSpec(value)
  const sourceIssues = inspectMotionDriverSourceBindings(graph, owner, spec)
  if (sourceIssues.length > 0)
    throw new RangeError(sourceIssues.map(({ message }) => message).join('; '))
  for (const driver of spec.drivers) {
    for (const nodeId of sourceNodeIds(driver.source)) {
      if (!graph.getNode(nodeId) || !belongsToOwner(graph, ownerNodeId, nodeId)) {
        throw new RangeError(`Motion driver source must belong to the owner subtree: ${nodeId}`)
      }
    }
    const target = graph.getNode(driver.target.targetNodeId)
    if (!target || !belongsToOwner(graph, ownerNodeId, target.id)) {
      throw new RangeError(
        `Motion driver ${driver.id} target must belong to the owner subtree: ${driver.target.targetNodeId}`
      )
    }
    const preparation = prepareMotionDriverTarget(driver, () => ({
      nodeId: target.id,
      motion: target.motion
    }))
    if (!preparation.success) throw new RangeError(preparation.issue.message)
  }
  return spec
}

export function nextMotionDriverId(spec: MotionDriverSpecV1 | undefined): string {
  const ids = new Set(spec?.drivers.map(({ id }) => id))
  for (let index = 1; index <= 10_000; index++) {
    const id = `driver-${index}`
    if (!ids.has(id)) return id
  }
  throw new RangeError('Unable to allocate a unique Motion driver id')
}

export function createMotionDriver(
  id: string,
  source: MotionDriverSource,
  target: Pick<MotionDriver['target'], 'targetNodeId' | 'trackId'>
): MotionDriver {
  const normalizedSource = { ...source }
  const inputMax =
    normalizedSource.kind === 'scroll' && normalizedSource.metric === 'offset' ? 1_000 : 1
  return {
    id,
    source: normalizedSource,
    target: { ...target },
    mapping: { inputMin: 0, inputMax, clamp: true, reverse: false, deadZone: 0 }
  }
}

export function replaceMotionDriver(
  spec: MotionDriverSpecV1,
  driverId: string,
  driver: MotionDriver
): MotionDriverSpecV1 {
  const draft = cloneMotionDriverSpec(spec)
  const index = draft.drivers.findIndex((candidate) => candidate.id === driverId)
  if (index === -1) throw new RangeError(`Unknown Motion driver: ${driverId}`)
  draft.drivers[index] = driver
  return parseMotionDriverSpec(draft)
}

export function removeMotionDriver(
  spec: MotionDriverSpecV1,
  driverId: string
): MotionDriverSpecV1 | undefined {
  const drivers = spec.drivers.filter((driver) => driver.id !== driverId)
  if (drivers.length === spec.drivers.length) {
    throw new RangeError(`Unknown Motion driver: ${driverId}`)
  }
  return drivers.length === 0 ? undefined : parseMotionDriverSpec({ version: 1, drivers })
}

export function updateMotionDriversWithUndo(
  editor: MotionDriverMutationEditor,
  ownerNodeId: string,
  value: MotionDriverSpecV1 | undefined,
  label: string,
  coalesceKey?: string
): boolean {
  const owner = editor.graph.getNode(ownerNodeId)
  if (!isMotionDriverOwner(owner)) return false
  const next = value ? validateMotionDriverReferences(editor.graph, ownerNodeId, value) : undefined
  if (JSON.stringify(owner.motionDrivers) === JSON.stringify(next)) return false
  const apply = () => editor.updateNodeWithUndo(ownerNodeId, { motionDrivers: next }, label)
  if (coalesceKey) editor.undo.runBatch(label, apply, coalesceKey)
  else apply()
  return true
}
