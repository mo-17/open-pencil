import { findComponentMasterAncestor, type LowcodeSelectOption } from '@open-pencil/lowcode'
import type { BindingExpr, SceneGraph, SceneNode, StateDef } from '@open-pencil/scene-graph'

/** Page computed reads are supported; document computed declarations remain unavailable. */
export function readableStateBindingOptions(
  graph: SceneGraph,
  node: SceneNode,
  pageId: string,
  type: StateDef['type'],
  pageLabel: string,
  documentLabel: string
): LowcodeSelectOption[] {
  return stateBindingOptions(graph, node, pageId, type, pageLabel, documentLabel, {
    rejectInstancePageState: true,
    readable: true
  })
}

/** Duplicate identities and computed declarations never acquire write authority. */
export function writableStateBindingOptions(
  graph: SceneGraph,
  node: SceneNode,
  pageId: string,
  type: StateDef['type'],
  pageLabel: string,
  documentLabel: string,
  options: { rejectInstancePageState?: boolean } = {}
): LowcodeSelectOption[] {
  return stateBindingOptions(graph, node, pageId, type, pageLabel, documentLabel, options)
}

function stateBindingOptions(
  graph: SceneGraph,
  node: SceneNode,
  pageId: string,
  type: StateDef['type'],
  pageLabel: string,
  documentLabel: string,
  options: { rejectInstancePageState?: boolean; readable?: boolean }
): LowcodeSelectOption[] {
  const pageUnavailable =
    hasCyclicParentChain(graph, node) ||
    findComponentMasterAncestor(graph, node) ||
    (options.rejectInstancePageState && hasInstanceAncestor(graph, node))
  const page = pageUnavailable ? undefined : graph.getNode(pageId)
  const project = (states: readonly StateDef[], scope: 'state' | 'doc', label: string) => {
    const ids = new Map<string, number>(),
      names = new Map<string, number>()
    for (const state of states) {
      ids.set(state.id, (ids.get(state.id) ?? 0) + 1)
      names.set(state.name, (names.get(state.name) ?? 0) + 1)
    }
    return states
      .filter(
        (state) =>
          state.type === type &&
          ((options.readable && scope === 'state') || state.computedExpr === undefined) &&
          ids.get(state.id) === 1 &&
          names.get(state.name) === 1
      )
      .map((state) => ({
        value: `${scope}:${scope === 'state' ? state.id : state.name}`,
        label: `${label}: ${state.name}`
      }))
  }
  return [
    ...project(page?.state ?? [], 'state', pageLabel),
    ...project(graph.getNode(graph.rootId)?.lowcodeDocumentState ?? [], 'doc', documentLabel)
  ]
}

function hasInstanceAncestor(graph: SceneGraph, node: SceneNode): boolean {
  let parent = node.parentId ? graph.getNode(node.parentId) : undefined
  while (parent) {
    if (parent.type === 'INSTANCE') return true
    parent = parent.parentId ? graph.getNode(parent.parentId) : undefined
  }
  return false
}

/** Project only a declared state choice; callers own unbound and expression modes. */
export function stateBindingSelection(
  binding: BindingExpr,
  options: readonly Pick<LowcodeSelectOption, 'value'>[]
): string {
  let value = ''
  if (binding.kind === 'ref') value = `state:${binding.stateId}`
  if (binding.kind === 'docState') value = `doc:${binding.docStateName}`
  return options.some((option) => option.value === value) ? value : 'invalid'
}

function hasCyclicParentChain(graph: SceneGraph, node: SceneNode): boolean {
  const seen = new Set<string>()
  let current: SceneNode | undefined = node
  while (current) {
    if (seen.has(current.id)) return true
    seen.add(current.id)
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return false
}
