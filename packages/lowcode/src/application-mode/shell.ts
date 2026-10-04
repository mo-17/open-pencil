import type { LowcodeApplicationShellV1, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  LOWCODE_APPLICATION_PAGE_PLUGIN_KEY,
  validateLowcodeApplication,
  validateLowcodeApplicationPage
} from './schema'

export interface ResolvedLowcodeApplicationShell extends LowcodeApplicationShellV1 {
  ok: true
  pageId: string
}
export type LowcodeApplicationShellResolution =
  | ResolvedLowcodeApplicationShell
  | { ok: false; nodeId: string; reason: string }

function editableFrame(node: SceneNode): boolean {
  return (
    node.type === 'FRAME' &&
    node.visible &&
    !node.locked &&
    !node.internalOnly &&
    !node.libraryId &&
    !node.libraryReadonly &&
    !node.librarySource &&
    Number.isFinite(node.x) &&
    Number.isFinite(node.y) &&
    Number.isFinite(node.width) &&
    Number.isFinite(node.height) &&
    node.width > 0 &&
    node.height > 0
  )
}

function eligibleSourcePage(graph: SceneGraph, page: SceneNode): boolean {
  return (
    page.type === 'CANVAS' &&
    page.parentId === graph.rootId &&
    page.visible &&
    !page.locked &&
    !page.internalOnly &&
    !page.lowcodeLibraryCache &&
    !page.libraryId &&
    !page.libraryReadonly &&
    !page.librarySource &&
    page.state === undefined &&
    page.events === undefined &&
    page.lowcodeWorkflows === undefined &&
    page.lowcodeServerWorkflows === undefined
  )
}

/** A shared frame belongs to an explicitly classified design page, without page-local behavior. */
export function lowcodeApplicationShellFrameEligible(
  graph: SceneGraph,
  frameNodeId: string
): boolean {
  const frame = graph.getNode(frameNodeId)
  const page = frame?.parentId ? graph.getNode(frame.parentId) : undefined
  if (
    !frame ||
    !contentAncestor(frame) ||
    !page ||
    !eligibleSourcePage(graph, page) ||
    !page.childIds.includes(frame.id)
  )
    return false
  if (
    page.pluginData.some(
      (entry) =>
        entry.pluginId === 'open-pencil' &&
        [
          LOWCODE_APPLICATION_PAGE_PLUGIN_KEY,
          'lowcode/state',
          'lowcode/events',
          'lowcode/workflows',
          'lowcode/serverWorkflows'
        ].includes(entry.key)
    )
  )
    return false
  const policy = validateLowcodeApplicationPage(page.lowcodeApplicationPage)
  return policy.ok && (policy.value.role === 'reference' || policy.value.role === 'components')
}

function contentAncestor(node: SceneNode): boolean {
  return (
    editableFrame(node) &&
    node.renderCondition === undefined &&
    node.interactiveProps?.dataSourceRef === undefined &&
    node.interactiveProps?.module === undefined &&
    node.interactiveProps?.image === undefined
  )
}

/** Only an empty flow Frame through ordinary, unconditional Frame ancestry can host a page. */
export function lowcodeApplicationShellSlotEligible(
  graph: SceneGraph,
  frameNodeId: string,
  slotNodeId: string
): boolean {
  if (frameNodeId === slotNodeId || !lowcodeApplicationShellFrameEligible(graph, frameNodeId))
    return false
  const slot = graph.getNode(slotNodeId)
  if (
    slot?.childIds.length !== 0 ||
    (slot.layoutMode !== 'VERTICAL' && slot.layoutMode !== 'HORIZONTAL')
  )
    return false
  const seen = new Set<string>()
  let current: SceneNode = slot
  while (!seen.has(current.id)) {
    seen.add(current.id)
    if (!contentAncestor(current)) return false
    if (current.id === frameNodeId) return true
    const parent: SceneNode | undefined = current.parentId
      ? graph.getNode(current.parentId)
      : undefined
    if (!parent?.childIds.includes(current.id)) return false
    current = parent
  }
  return false
}

/** Resolve saved references afresh; invalid references remain authored and never rebind automatically. */
export function resolveLowcodeApplicationShell(
  graph: SceneGraph,
  shell: LowcodeApplicationShellV1
): LowcodeApplicationShellResolution {
  const policy = validateLowcodeApplication({ version: 1, enabled: true, shell })
  if (!policy.ok || !policy.value.shell)
    return {
      ok: false,
      nodeId: graph.rootId,
      reason: 'Shared layout requires a closed frame and content-region reference pair.'
    }
  const value = policy.value.shell
  if (!lowcodeApplicationShellFrameEligible(graph, value.frameNodeId))
    return {
      ok: false,
      nodeId: value.frameNodeId,
      reason:
        'Shared layout must be an editable direct Frame on a reference or components page without page-local state, events or workflows.'
    }
  if (!lowcodeApplicationShellSlotEligible(graph, value.frameNodeId, value.slotNodeId))
    return {
      ok: false,
      nodeId: value.slotNodeId,
      reason:
        'Content region must be an empty flow Frame inside ordinary editable unconditional Frames.'
    }
  const frame = graph.getNode(value.frameNodeId)
  if (!frame?.parentId)
    return { ok: false, nodeId: value.frameNodeId, reason: 'Shared layout source page is missing.' }
  return { ok: true, ...value, pageId: frame.parentId }
}
