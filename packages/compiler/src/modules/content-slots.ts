import type { IRModule, IRNode, IRWarning } from '#compiler/ir/types'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { collectWalktourContentSlots, isWalktourModule } from './walktour-content'

interface ContentRequest {
  name: string
  childName: string
}

function contentRequests(module: IRModule): ContentRequest[] | undefined {
  if (
    (module.pluginId === 'open-pencil.modal' && module.moduleType === 'modal') ||
    (module.pluginId === 'open-pencil.popover' && module.moduleType === 'popover') ||
    (module.pluginId === 'open-pencil.slide-menu' && module.moduleType === 'slide-menu')
  ) {
    const childName = module.payload.contentChildName
    if (typeof childName !== 'string') return undefined
    return childName ? [{ name: 'content', childName }] : []
  }
  if (module.pluginId !== 'open-pencil.tabs' || module.moduleType !== 'tabs') return undefined
  const tabs = module.payload.tabs
  if (
    !Array.isArray(tabs) ||
    !tabs.some((tab) => tab && typeof tab === 'object' && typeof tab.contentChildName === 'string')
  )
    return undefined
  return tabs.flatMap((tab: unknown) => {
    if (!tab || typeof tab !== 'object') return []
    const { id, contentChildName } = tab as { id?: unknown; contentChildName?: unknown }
    return typeof id === 'string' && typeof contentChildName === 'string' && contentChildName
      ? [{ name: `panel-${id}`, childName: contentChildName }]
      : []
  })
}

export function moduleChildSourceId(node: IRNode): string | undefined {
  if (node.kind === 'conditional') return moduleChildSourceId(node.consequent)
  return 'sourceId' in node ? node.sourceId : undefined
}

/** Names remain local to the owning module. Reordering, cloning and .fig round trips
 * therefore need no persisted ID rewriting. All children stay in the IR for normal
 * state/validation/dependency walks; emitters route only the selected subtrees. */
export function collectModuleContentSlots(
  node: SceneNode,
  module: IRModule | null,
  graph: SceneGraph,
  children: readonly IRNode[],
  warnings: IRWarning[]
): void {
  if (!module) return
  if (isWalktourModule(module)) {
    collectWalktourContentSlots(node, module, graph, children, warnings)
    return
  }
  const requests = contentRequests(module)
  if (!requests) return
  const directChildren = node.childIds.flatMap((id) => graph.getNode(id) ?? [])
  const emittedIds = new Set(children.map(moduleChildSourceId))
  const usedNames = new Map<string, number>()
  for (const request of requests) {
    usedNames.set(request.childName, (usedNames.get(request.childName) ?? 0) + 1)
  }
  module.contentSlots = requests.map(({ name, childName }) => {
    const matches = directChildren.filter((child) => child.name === childName)
    const child = matches.length === 1 ? matches[0] : undefined
    const valid = child && usedNames.get(childName) === 1 && emittedIds.has(child.id)
    if (!valid) {
      warnings.push({
        code: 'module-content-child-invalid',
        nodeId: node.id,
        message: `Module content slot ${name} requires one unique, renderable direct child named ${JSON.stringify(childName)}; no content was substituted.`
      })
    }
    return { name, sourceId: valid ? child.id : null }
  })
  const assigned = new Set(module.contentSlots.map((slot) => slot.sourceId))
  if (children.some((child) => !assigned.has(moduleChildSourceId(child) ?? null))) {
    warnings.push({
      code: 'module-content-child-unassigned',
      nodeId: node.id,
      message:
        'Explicit module content mapping omits unassigned children; they are not rendered as triggers or shared panel content.'
    })
  }
}

/** A slotted subtree starts a new content flow; its original absolute placement
 * belongs to the canvas module host, not to the dialog/panel body. Descendants
 * keep their authored layout, sizing, styling and behavior. */
function contentRoot(node: IRNode): IRNode {
  if (node.kind === 'conditional') return { ...node, consequent: contentRoot(node.consequent) }
  if (!('className' in node) || typeof node.className !== 'string') return node
  const classes = node.className.split(/\s+/)
  if (!classes.includes('absolute')) return node
  return {
    ...node,
    className: [
      ...classes.filter(
        (name) => name !== 'absolute' && !/^-?(?:left|right|top|bottom|inset)-/.test(name)
      ),
      'relative'
    ].join(' ')
  }
}

export function moduleContentNodes(node: { module?: IRModule; children: readonly IRNode[] }) {
  if (isWalktourModule(node.module)) {
    return node.module?.contentSlots?.map((slot) => ({
      name: slot.name,
      nodes:
        slot.childIndex !== undefined &&
        Number.isInteger(slot.childIndex) &&
        slot.childIndex >= 0 &&
        slot.childIndex < node.children.length
          ? node.children.slice(slot.childIndex, slot.childIndex + 1)
          : []
    }))
  }
  return node.module?.contentSlots?.map((slot) => ({
    name: slot.name,
    nodes:
      slot.sourceId === null
        ? []
        : node.children
            .filter((child) => moduleChildSourceId(child) === slot.sourceId)
            .map(contentRoot)
  }))
}

/** Nested forms own their own validation and are not part of the caller's scope. */
export function containsModuleContent(nodes: readonly IRNode[]): boolean {
  return nodes.some((node) => {
    if (node.kind === 'conditional') return containsModuleContent([node.consequent])
    if (node.kind === 'list') return containsModuleContent([node.template])
    if (node.kind !== 'element' || node.tag === 'form') return false
    return (
      node.module?.contentSlots !== undefined ||
      (node.module?.valueFields?.length ?? 0) > 0 ||
      containsModuleContent(node.children)
    )
  })
}

/** Mark original IR fields, not the layout-adjusted slot projection copies. */
export function markModuleFormValidationScope(nodes: readonly IRNode[]): void {
  for (const node of nodes) {
    if (node.kind === 'conditional') markModuleFormValidationScope([node.consequent])
    else if (node.kind === 'list') markModuleFormValidationScope([node.template])
    else if (node.kind === 'element' && node.tag !== 'form') {
      if (node.validation) node.validationScopeMarker = true
      for (const field of node.module?.valueFields ?? [])
        if (field.validation) field.validationScopeMarker = true
      const slots = isWalktourModule(node.module) ? undefined : node.module?.contentSlots
      const ids = slots ? new Set(slots.map((slot) => slot.sourceId)) : undefined
      markModuleFormValidationScope(
        ids
          ? node.children.filter((child) => ids.has(moduleChildSourceId(child) ?? null))
          : node.children
      )
    }
  }
}
