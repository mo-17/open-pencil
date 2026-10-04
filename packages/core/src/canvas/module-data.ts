import type { SceneGraph, SceneNode, StateDef } from '@open-pencil/scene-graph'

import { moduleDataField } from '#core/plugins/bindings/data'

import { containingStatePage } from './control-state'

/** Static design projection never evaluates expressions or computed runtime state. */
export function readModuleDataInitial(
  node: SceneNode,
  graph: SceneGraph | undefined,
  key: 'rows' | 'data'
): { bound: boolean; value: unknown } {
  const field = moduleDataField(node)
  const bindings = node.bindings
  if (field?.key !== key || !bindings || !Object.hasOwn(bindings, key))
    return { bound: false, value: undefined }
  const unavailable = { bound: true, value: undefined }
  if (!graph) return unavailable
  const binding: unknown = Object.getOwnPropertyDescriptor(bindings, key)?.value
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return unavailable
  const own = (name: string): unknown => Object.getOwnPropertyDescriptor(binding, name)?.value
  const target = dataStateTarget(graph, node, own('kind'), own('docStateName'), own('stateId'))
  const { state, states } = target
  if (
    !state ||
    state.type !== field.type ||
    state.computedExpr !== undefined ||
    states.filter((candidate) => candidate.id === state.id || candidate.name === state.name)
      .length !== 1
  )
    return unavailable
  return { bound: true, value: Object.getOwnPropertyDescriptor(state, 'defaultValue')?.value }
}

function dataStateTarget(
  graph: SceneGraph,
  node: SceneNode,
  kind: unknown,
  name: unknown,
  id: unknown
): { state: StateDef | undefined; states: readonly StateDef[] } {
  const isDocument = kind === 'docState'
  let states: readonly StateDef[] = []
  if (isDocument) states = graph.getNode(graph.rootId)?.lowcodeDocumentState ?? []
  else if (kind === 'ref') states = containingStatePage(graph, node)?.state ?? []
  const identity = isDocument ? name : id
  const state =
    typeof identity === 'string'
      ? states.find((candidate) =>
          isDocument ? candidate.name === identity : candidate.id === identity
        )
      : undefined
  return { state, states }
}
