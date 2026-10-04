import {
  resolveLowcodeApplicationPages,
  resolveLowcodeApplicationShell
} from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { IRTree, IRWarning } from '../types'
import {
  collectApplicationShellSources,
  fillApplicationShellEntry,
  projectApplicationShellPage
} from './shell-projection'

export interface CompilerApplicationScope {
  graph: SceneGraph
  pageIds: string[]
  application: boolean
  blocked: boolean
  warnings: IRWarning[]
  getPageGraph?: (pageId: string) => SceneGraph
  projectTree?: (pageId: string, tree: IRTree) => IRTree
  shellNodeIds?: ReadonlySet<string>
  fontNodeIds?: string[]
}

/** A compiler-only view: document identity, registries and authored nodes stay intact. */
export function resolveCompilerApplicationScope(
  graph: SceneGraph,
  pageIds: readonly string[]
): CompilerApplicationScope {
  const selection = resolveLowcodeApplicationPages(graph, pageIds)
  if (selection.mode === 'legacy') {
    return { graph, pageIds: [...pageIds], application: false, blocked: false, warnings: [] }
  }
  const warnings: IRWarning[] = [...selection.warnings]
  if (selection.mode === 'invalid' || warnings.length > 0 || selection.pages.length === 0) {
    return { graph, pageIds: [], application: true, blocked: true, warnings }
  }
  const projected = new Map<string, SceneNode>()
  for (const { pageId, entryNodeId } of selection.pages) {
    const page = graph.getNode(pageId)
    const entry = entryNodeId ? graph.getNode(entryNodeId) : undefined
    if (!page || !entry) {
      warnings.push({
        code: 'application-entry-invalid',
        nodeId: pageId,
        message: 'Application entry is unavailable; no application project was emitted.'
      })
      return { graph, pageIds: [], application: true, blocked: true, warnings }
    }
    if (
      ![entry.x, entry.y, entry.width, entry.height].every(Number.isFinite) ||
      entry.width <= 0 ||
      entry.height <= 0
    ) {
      warnings.push({
        code: 'application-entry-geometry-invalid',
        nodeId: entry.id,
        message:
          'Application entry requires finite positions and positive finite width and height; no application project was emitted.'
      })
      return { graph, pageIds: [], application: true, blocked: true, warnings }
    }
    projected.set(page.id, { ...page, childIds: [entry.id] })
    projected.set(entry.id, atLocalOrigin(entry))
  }
  const selectedIds = selection.pages.map(({ pageId }) => pageId)
  const getNode = (id: string): SceneNode | undefined => projected.get(id) ?? graph.getNode(id)
  const getChildren = (id: string): SceneNode[] =>
    (getNode(id)?.childIds ?? []).flatMap((childId) => getNode(childId) ?? [])
  const view = new Proxy(graph, {
    get(target, property) {
      if (property === 'getNode') return getNode
      if (property === 'getChildren') return getChildren
      if (property === 'getPages') return () => selectedIds.flatMap((id) => getNode(id) ?? [])
      const member: unknown = Reflect.get(target, property, target)
      return typeof member === 'function' ? member.bind(target) : member
    }
  })
  if (!selection.shell) {
    return { graph: view, pageIds: selectedIds, application: true, blocked: false, warnings }
  }
  const shell = resolveLowcodeApplicationShell(graph, selection.shell)
  if (!shell.ok) {
    return {
      graph,
      pageIds: [],
      application: true,
      blocked: true,
      warnings: [{ code: 'application-shell-invalid', nodeId: shell.nodeId, message: shell.reason }]
    }
  }
  const behavior = collectApplicationShellSources(graph, shell.frameNodeId)
  if (behavior.warnings.length > 0) {
    return { graph, pageIds: [], application: true, blocked: true, warnings: behavior.warnings }
  }
  const pageViews = new Map(
    selection.pages.map(({ pageId, entryNodeId }) => [
      pageId,
      projectApplicationShellPage(view, shell, pageId, entryNodeId as string, selectedIds)
    ])
  )
  const entries = new Map(
    selection.pages.map(({ pageId, entryNodeId }) => [pageId, entryNodeId as string])
  )
  return {
    graph: view,
    pageIds: selectedIds,
    application: true,
    blocked: false,
    warnings,
    getPageGraph: (pageId) => pageViews.get(pageId) ?? view,
    projectTree: (pageId, tree) =>
      fillApplicationShellEntry(tree, entries.get(pageId) as string, shell.slotNodeId),
    shellNodeIds: behavior.nodeIds,
    fontNodeIds: [...selectedIds, shell.frameNodeId]
  }
}

function atLocalOrigin(entry: SceneNode): SceneNode {
  const responsiveOverrides = entry.responsiveOverrides
    ? Object.fromEntries(
        Object.entries(entry.responsiveOverrides).map(([breakpoint, override]) => [
          breakpoint,
          { ...override, x: 0, y: 0 }
        ])
      )
    : undefined
  return {
    ...entry,
    x: 0,
    y: 0,
    ...(entry.derivedLayout ? { derivedLayout: { ...entry.derivedLayout, x: 0, y: 0 } } : {}),
    ...(responsiveOverrides ? { responsiveOverrides } : {})
  }
}
