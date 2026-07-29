import {
  clonePrototypeSpec,
  parseMotionTransitionKey,
  parsePrototypeSpec,
  type MotionTransitionKey,
  type PrototypeConnection,
  type PrototypeSpecV1,
  type SceneNode
} from '@open-pencil/scene-graph'

export interface PrototypeMutationEditor {
  graph: {
    getNode(id: string): SceneNode | undefined
    getAllNodes(): Iterable<SceneNode>
  }
  updateNodeWithUndo(id: string, changes: Partial<SceneNode>, label?: string): void
}

export interface PrototypeTargetOption {
  readonly id: string
  readonly name: string
  readonly type: 'CANVAS' | 'FRAME'
}

export type PrototypeAuthoringIssueCode =
  | 'missing-owner'
  | 'click-conflict'
  | 'missing-target'
  | 'invalid-target'

export class PrototypeAuthoringError extends Error {
  constructor(
    readonly code: PrototypeAuthoringIssueCode,
    message: string
  ) {
    super(message)
    this.name = 'PrototypeAuthoringError'
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

function validateTargets(
  editor: PrototypeMutationEditor,
  owner: SceneNode,
  spec: PrototypeSpecV1
): void {
  if (
    spec.connections.some((connection) => connection.trigger.kind === 'click') &&
    (owner.events?.onClick?.length ?? 0) > 0
  ) {
    throw new PrototypeAuthoringError(
      'click-conflict',
      'Prototype click connections conflict with existing lowcode onClick actions.'
    )
  }

  for (const connection of spec.connections) {
    const action = connection.action
    if (action.kind !== 'navigate' && action.kind !== 'openOverlay') continue
    const target = editor.graph.getNode(action.targetNodeId)
    if (!target) {
      throw new PrototypeAuthoringError(
        'missing-target',
        `Prototype target not found: ${action.targetNodeId}`
      )
    }
    if (target.type !== 'CANVAS' && target.type !== 'FRAME') {
      throw new PrototypeAuthoringError(
        'invalid-target',
        `Prototype target must be a page or frame: ${target.id}`
      )
    }
  }
}

export function listPrototypeTargets(editor: PrototypeMutationEditor): PrototypeTargetOption[] {
  return [...editor.graph.getAllNodes()]
    .filter(
      (node): node is SceneNode & { type: 'CANVAS' | 'FRAME' } =>
        node.type === 'CANVAS' || node.type === 'FRAME'
    )
    .map(({ id, name, type }) => ({ id, name, type }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, 'en') || left.id.localeCompare(right.id, 'en')
    )
}

export function nextPrototypeConnectionId(spec: PrototypeSpecV1 | undefined): string {
  const used = new Set(spec?.connections.map(({ id }) => id))
  for (let index = 1; index <= 10_000; index++) {
    const id = `connection-${index}`
    if (!used.has(id)) return id
  }
  throw new RangeError('Unable to allocate a bounded Prototype connection id')
}

export function updateNodePrototypeWithUndo(
  editor: PrototypeMutationEditor,
  nodeId: string,
  value: PrototypeSpecV1 | undefined,
  label: string
): boolean {
  const owner = editor.graph.getNode(nodeId)
  if (!owner) throw new PrototypeAuthoringError('missing-owner', `Node not found: ${nodeId}`)
  const next = value ? parsePrototypeSpec(value) : undefined
  if (next) validateTargets(editor, owner, next)
  if (sameValue(owner.prototype, next)) return false
  editor.updateNodeWithUndo(nodeId, { prototype: next }, label)
  return true
}

export function addPrototypeConnection(
  value: PrototypeSpecV1 | undefined,
  connection: PrototypeConnection
): PrototypeSpecV1 {
  return parsePrototypeSpec({
    version: 1,
    connections: [...(value?.connections ?? []), connection]
  })
}

export function replacePrototypeConnection(
  value: PrototypeSpecV1,
  connection: PrototypeConnection
): PrototypeSpecV1 {
  const current = parsePrototypeSpec(value)
  const index = current.connections.findIndex(({ id }) => id === connection.id)
  if (index === -1) throw new RangeError(`Unknown Prototype connection: ${connection.id}`)
  const connections = [...current.connections]
  connections[index] = connection
  return parsePrototypeSpec({ version: 1, connections })
}

export function removePrototypeConnection(
  value: PrototypeSpecV1,
  connectionId: string
): PrototypeSpecV1 | undefined {
  const current = clonePrototypeSpec(value)
  const connections = current.connections.filter(({ id }) => id !== connectionId)
  if (connections.length === current.connections.length) {
    throw new RangeError(`Unknown Prototype connection: ${connectionId}`)
  }
  return connections.length === 0 ? undefined : parsePrototypeSpec({ version: 1, connections })
}

export function updateNodeTransitionKeyWithUndo(
  editor: PrototypeMutationEditor,
  nodeId: string,
  value: string | undefined,
  label: string
): MotionTransitionKey | undefined {
  const node = editor.graph.getNode(nodeId)
  if (!node) throw new PrototypeAuthoringError('missing-owner', `Node not found: ${nodeId}`)
  const trimmed = value?.trim()
  const next = trimmed ? parseMotionTransitionKey(trimmed) : undefined
  if (node.transitionKey !== next) {
    editor.updateNodeWithUndo(nodeId, { transitionKey: next }, label)
  }
  return next
}
