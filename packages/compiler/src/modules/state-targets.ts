import type { IRStateDecl } from '#compiler/ir/types'

import type { SceneGraph, SceneNode, StateDef } from '@open-pencil/scene-graph'

interface ModuleStateTarget {
  state: IRStateDecl | undefined
  document: boolean
  declarations: readonly StateDef[]
}

/** Read own data fields without executing document getters. */
export function moduleStateTarget(
  graph: SceneGraph,
  node: SceneNode,
  binding: unknown,
  states: ReadonlyMap<string, IRStateDecl>,
  docStates: ReadonlyMap<string, IRStateDecl>,
  rejectReusableBodies = false
): ModuleStateTarget {
  const own = (key: string): unknown =>
    binding && typeof binding === 'object' && !Array.isArray(binding)
      ? Object.getOwnPropertyDescriptor(binding, key)?.value
      : undefined
  const kind = own('kind'),
    id = own('stateId'),
    name = own('docStateName')
  const document = kind === 'docState'
  let state: IRStateDecl | undefined
  if (kind === 'ref' && typeof id === 'string') state = states.get(id)
  if (document && typeof name === 'string') state = docStates.get(name)
  return {
    state,
    document,
    declarations: document
      ? (graph.getNode(graph.rootId)?.lowcodeDocumentState ?? [])
      : pageDeclarations(graph, node, rejectReusableBodies)
  }
}

/** Duplicate IDs or names cannot safely identify one writable business state. */
export function writableModuleState(
  state: IRStateDecl | undefined,
  declarations: readonly StateDef[],
  type: IRStateDecl['type']
): state is IRStateDecl {
  return Boolean(
    state &&
    declarations.filter((candidate) => candidate.name === state.name || candidate.id === state.id)
      .length === 1 &&
    state.type === type &&
    !state.computed &&
    state.computedExpr === undefined &&
    !state.computedInvalid
  )
}

export function pageDeclarations(
  graph: SceneGraph,
  node: SceneNode,
  rejectReusableBodies = false
): readonly StateDef[] {
  const seen = new Set<string>()
  let current: SceneNode | undefined = node
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (
      rejectReusableBodies &&
      (current.type === 'COMPONENT' ||
        current.type === 'COMPONENT_SET' ||
        current.type === 'INSTANCE')
    )
      return []
    if (current.type === 'CANVAS') return current.state ?? []
    current = graph.getNode(current.parentId ?? '')
  }
  return []
}
