import type { ResolvedLowcodeApplicationShell } from '@open-pencil/lowcode'
import { getAbsolutePosition, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import type { IRLayout, IRNode, IRTree, IRWarning } from '../types'

/** Follow authored shell descendants and referenced component bodies, without selecting whole pages. */
export function collectApplicationShellSources(graph: SceneGraph, frameNodeId: string) {
  const nodeIds = new Set<string>()
  const warnings: IRWarning[] = []
  const pending = [frameNodeId]
  while (pending.length > 0) {
    const id = pending.pop() as string
    if (nodeIds.has(id)) continue
    nodeIds.add(id)
    const node = graph.getNode(id)
    if (!node) {
      warnings.push(shellBehaviorWarning(id, 'Shell references an unavailable node.'))
      continue
    }
    if (
      node.type === 'FORM' ||
      node.type === 'LIST' ||
      node.renderCondition ||
      node.prototype ||
      node.motion ||
      node.motionDrivers ||
      node.motionScene ||
      node.transitionKey
    ) {
      warnings.push(
        shellBehaviorWarning(
          id,
          'Shared shells do not support forms, lists, conditional rendering, prototypes or Motion.'
        )
      )
    }
    pending.push(...node.childIds)
    if (node.type === 'INSTANCE' && node.componentId) {
      pending.push(node.componentId)
      const master = graph.getNode(node.componentId)
      const owner = master?.parentId ? graph.getNode(master.parentId) : undefined
      if (owner?.type === 'COMPONENT_SET') pending.push(owner.id)
    }
  }
  return { nodeIds, warnings }
}

export function shellBehaviorWarning(nodeId: string, reason: string): IRWarning {
  return {
    code: 'application-shell-behavior-invalid',
    nodeId,
    message: `${reason} No application project was emitted.`
  }
}

function atShellOrigin(node: SceneNode, changes: Partial<SceneNode> = {}): SceneNode {
  return {
    ...node,
    x: 0,
    y: 0,
    ...(node.derivedLayout ? { derivedLayout: { ...node.derivedLayout, x: 0, y: 0 } } : {}),
    ...(node.responsiveOverrides
      ? {
          responsiveOverrides: Object.fromEntries(
            Object.entries(node.responsiveOverrides).map(([key, value]) => [
              key,
              { ...value, x: 0, y: 0 }
            ])
          )
        }
      : {}),
    ...changes
  }
}

function contentEntry(entry: SceneNode, slotNodeId: string): SceneNode {
  const projected = atShellOrigin(entry, { parentId: slotNodeId, layoutPositioning: 'AUTO' })
  if (entry.responsiveOverrides) {
    projected.responsiveOverrides = Object.fromEntries(
      Object.entries(entry.responsiveOverrides).map(([key, override]) => {
        return [key, { ...override, x: 0, y: 0, layoutPositioning: 'AUTO' }]
      })
    )
  }
  return projected
}

function fillWidthLayout(layout: IRLayout): IRLayout {
  return {
    ...layout,
    widthSizing: 'FILL',
    ...(layout.layoutMode === 'HORIZONTAL'
      ? { primaryAxisSizing: 'FILL' as const }
      : { counterAxisSizing: 'FILL' as const })
  }
}

function fillWidthClasses(className: string): string {
  return [
    ...className.split(/\s+/).filter((token) => token && !/^(?:[^:]+:)*w-/.test(token)),
    'w-full'
  ].join(' ')
}

/** Physical width changes after responsive axis resolution; authored effective heights stay intact. */
export function fillApplicationShellEntry(
  tree: IRTree,
  entryNodeId: string,
  slotNodeId: string
): IRTree {
  const emittedSources = new Set<string>()
  const project = (node: IRNode): IRNode => {
    if (node.kind === 'conditional') return { ...node, consequent: project(node.consequent) }
    if (node.kind === 'list') return { ...node, template: project(node.template) }
    if (node.kind !== 'element' && node.kind !== 'componentRef') return node
    const children = node.kind === 'element' ? { children: node.children.map(project) } : {}
    if (node.sourceId !== entryNodeId) return { ...node, ...children }
    emittedSources.add(node.sourceId)
    return {
      ...node,
      ...children,
      className: fillWidthClasses(node.className),
      ...(node.layout ? { layout: fillWidthLayout(node.layout) } : {}),
      ...(node.responsiveLayout
        ? {
            responsiveLayout: node.responsiveLayout.map((range) => ({
              ...range,
              className: fillWidthClasses(range.className),
              layout: fillWidthLayout(range.layout)
            }))
          }
        : {})
    }
  }
  const children = tree.children.map(project)
  return {
    ...tree,
    children,
    ...(emittedSources.has(entryNodeId)
      ? {}
      : {
          warnings: [
            ...tree.warnings,
            shellBehaviorWarning(
              slotNodeId,
              `Shared shell omitted application entry ${JSON.stringify(entryNodeId)}.`
            )
          ]
        })
  }
}

/** One view per route keeps shared authored IDs while giving them the active route's parent chain. */
export function projectApplicationShellPage(
  graph: SceneGraph,
  shell: ResolvedLowcodeApplicationShell,
  pageId: string,
  entryNodeId: string,
  pageIds: readonly string[]
): SceneGraph {
  const page = graph.getNode(pageId) as SceneNode
  const frame = graph.getNode(shell.frameNodeId) as SceneNode
  const slot = graph.getNode(shell.slotNodeId) as SceneNode
  const sourcePage = graph.getNode(shell.pageId) as SceneNode
  const entry = graph.getNode(entryNodeId) as SceneNode
  const projected = new Map<string, SceneNode>([
    [page.id, { ...page, childIds: [frame.id] }],
    [
      sourcePage.id,
      { ...sourcePage, childIds: sourcePage.childIds.filter((id) => id !== frame.id) }
    ],
    [frame.id, atShellOrigin(frame, { parentId: page.id })],
    [slot.id, { ...slot, childIds: [entry.id] }],
    [entry.id, contentEntry(entry, slot.id)]
  ])
  const getNode = (id: string): SceneNode | undefined => projected.get(id) ?? graph.getNode(id)
  const getChildren = (id: string) =>
    (getNode(id)?.childIds ?? []).flatMap((childId) => getNode(childId) ?? [])
  const ancestors = (id: string): SceneNode[] => {
    const result: SceneNode[] = [],
      seen = new Set<string>()
    let node = getNode(id)
    while (node && !seen.has(node.id)) {
      result.push(node)
      seen.add(node.id)
      node = node.parentId ? getNode(node.parentId) : undefined
    }
    return result
  }
  const view: SceneGraph = new Proxy(graph, {
    get(target, key) {
      if (key === 'getNode') return getNode
      if (key === 'getChildren') return getChildren
      if (key === 'getPages') return () => pageIds.flatMap((id) => getNode(id) ?? [])
      if (key === 'getAllNodes')
        return () => [...graph.getAllNodes()].map((node) => getNode(node.id) as SceneNode)
      if (key === 'getPageId')
        return (id: string) => ancestors(id).find((node) => node.type === 'CANVAS')?.id
      if (key === 'isDescendant')
        return (id: string, ancestorId: string) =>
          ancestors(id).some((node) => node.id === ancestorId)
      if (key === 'getAbsolutePosition')
        return (id: string) => {
          const node = getNode(id)
          return node ? getAbsolutePosition(node, view) : { x: 0, y: 0 }
        }
      if (key === 'getAbsoluteBounds')
        return (id: string) => {
          const node = getNode(id),
            position = view.getAbsolutePosition(id)
          return { ...position, width: node?.width ?? 0, height: node?.height ?? 0 }
        }
      const member: unknown = Reflect.get(target, key, target)
      return typeof member === 'function' ? member.bind(target) : member
    }
  })
  return view
}
