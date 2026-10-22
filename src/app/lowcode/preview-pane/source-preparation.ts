import type { Editor } from '@open-pencil/core/editor'
import { validateLowcodeApplication, validateLowcodeApplicationPage } from '@open-pencil/lowcode'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { applicationRawEntry } from '@/app/lowcode/application-mode/model'

function hasRawPolicy(node: SceneNode): boolean {
  return node.pluginData.some((entry) => applicationRawEntry(entry, node.type === 'CANVAS'))
}

function applicationPolicy(graph: SceneGraph) {
  const root = graph.getNode(graph.rootId)
  const policy = validateLowcodeApplication(root?.lowcodeApplication)
  return root?.type === 'FRAME' &&
    root.parentId === null &&
    root.id === graph.rootId &&
    !hasRawPolicy(root) &&
    policy.ok &&
    policy.value.enabled
    ? policy.value
    : null
}

function pageRole(graph: SceneGraph, page: SceneNode) {
  if (page.type !== 'CANVAS' || page.parentId !== graph.rootId || hasRawPolicy(page)) return null
  const policy = validateLowcodeApplicationPage(page.lowcodeApplicationPage)
  return policy.ok ? policy.value.role : null
}

/** Keep lazy application input and its authority tied to one owned preview build. */
export function createPreviewSourcePreparation(
  editor: Pick<Editor, 'graph' | 'loadPageNodes'> & Partial<Pick<Editor, 'settleShaderFrames'>>,
  requestIsCurrent: () => boolean
) {
  const graph = editor.graph
  const root = graph.getNode(graph.rootId)
  const pageIds = new Set(graph.getPages().map((page) => page.id))
  let invalidated = false
  const rawPolicies = new Set(
    [root, ...graph.getPages()].flatMap((node) => (node && hasRawPolicy(node) ? [node.id] : []))
  )
  const stop = graph.onNodeEvents({
    created(node, origin) {
      if (origin !== 'source-hydration' && node.type === 'CANVAS' && node.parentId === graph.rootId)
        invalidated = true
    },
    reordered(_id, parentId, _index, previousParentId, origin) {
      if (
        origin !== 'source-hydration' &&
        (parentId === graph.rootId || previousParentId === graph.rootId)
      )
        invalidated = true
    },
    updated(id, changes, origin) {
      // A reader remaps references while populating pages. Authored policy changes invalidate
      // the build even under Manual/Save, whose ordinary edits can retain an explicit request.
      const node = graph.getNode(id)
      const wasRaw = rawPolicies.has(id)
      const isRaw = node ? hasRawPolicy(node) : false
      if (isRaw) rawPolicies.add(id)
      else rawPolicies.delete(id)
      if (origin === 'source-hydration') return
      const rawPolicyChanged = Object.hasOwn(changes, 'pluginData') && (wasRaw || isRaw)
      if (
        (id === graph.rootId &&
          (Object.hasOwn(changes, 'lowcodeApplication') || rawPolicyChanged)) ||
        (graph.getNode(id)?.type === 'CANVAS' &&
          (Object.hasOwn(changes, 'lowcodeApplicationPage') ||
            Object.hasOwn(changes, 'lowcodeRoutePattern') ||
            rawPolicyChanged))
      )
        invalidated = true
    },
    deleted(id, _parentId, origin) {
      if (origin !== 'source-hydration' && (id === graph.rootId || pageIds.has(id)))
        invalidated = true
    },
    reparented(_id, oldParentId, newParentId, origin) {
      if (
        origin !== 'source-hydration' &&
        (oldParentId === graph.rootId || newParentId === graph.rootId)
      )
        invalidated = true
    }
  })
  const isCurrent = () =>
    requestIsCurrent() &&
    !invalidated &&
    editor.graph === graph &&
    graph.getNode(graph.rootId) === root

  async function prepare(): Promise<boolean> {
    if (!isCurrent()) return false
    // Ordinary design documents retain the existing lazy loading policy. Invalid/inert policies
    // remain untouched so the compiler can report their existing diagnostics.
    if (!applicationPolicy(graph)) return true
    const applicationPages = graph
      .getPages()
      .filter((page) => pageRole(graph, page) === 'application')
    for (const page of applicationPages) {
      if (!isCurrent()) return false
      if (!applicationPolicy(graph)) return true
      await editor.loadPageNodes(page.id)
      if (!isCurrent()) return false
    }

    const shell = applicationPolicy(graph)?.shell
    if (shell) {
      const knownPage = graph.pageOf(shell.frameNodeId)
      const candidates = graph.getPages().filter((page) => {
        const role = pageRole(graph, page)
        return (
          (role === 'reference' || role === 'components') &&
          (knownPage === null || page.id === knownPage)
        )
      })
      // An unresolved shell has no public node-to-lazy-page index. Search only explicitly
      // classified source pages, stopping when the configured frame has a live owner page.
      for (const page of candidates) {
        if (!isCurrent()) return false
        if (!applicationPolicy(graph)) return true
        await editor.loadPageNodes(page.id)
        if (!isCurrent()) return false
        const currentShell = applicationPolicy(graph)?.shell
        if (currentShell && graph.pageOf(currentShell.frameNodeId)) break
      }
    }
    await editor.settleShaderFrames?.({ nodeIds: [...pageIds], requireFrames: true })
    return isCurrent()
  }

  return { graph, prepare, isCurrent, dispose: stop }
}
