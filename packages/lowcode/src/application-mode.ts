import type {
  LowcodeApplicationShellV1,
  LowcodeApplicationStateRetention,
  LowcodeApplicationEnterGuardV1,
  LowcodeApplicationLeaveConfirmV1,
  LowcodeApplicationPageV1,
  SceneGraph,
  SceneNode
} from '@open-pencil/scene-graph'

import { validateLowcodeApplicationGuardRoutes } from './application-mode/guard-routes'
import {
  LOWCODE_APPLICATION_PLUGIN_KEY,
  LOWCODE_APPLICATION_PAGE_PLUGIN_KEY,
  validateLowcodeApplication,
  validateLowcodeApplicationPage
} from './application-mode/schema'
import { resolveLowcodeApplicationShell } from './application-mode/shell'
import { deriveLowcodePageRoutes } from './routes'
export * from './application-mode/schema'
export * from './application-mode/shell'
export * from './application-mode/guard-routes'
export {
  LOWCODE_APPLICATION_GUARD_EXPRESSION_MAX_LENGTH,
  LOWCODE_APPLICATION_GUARD_FALLBACK_MAX_LENGTH,
  LOWCODE_APPLICATION_GUARD_MESSAGE_MAX_LENGTH,
  validateLowcodeApplicationGuardExpression,
  validateLowcodeApplicationGuardFallback,
  validateLowcodeApplicationGuardMessage,
  validateLowcodeApplicationEnterGuard,
  validateLowcodeApplicationLeaveConfirm,
  type LowcodeApplicationEnterGuardValidation,
  type LowcodeApplicationLeaveConfirmValidation
} from './application-mode/guards'

export type LowcodeApplicationWarningCode =
  | 'application-invalid'
  | 'application-inert'
  | 'application-page-invalid'
  | 'application-page-inert'
  | 'application-entry-invalid'
  | 'application-start-invalid'
  | 'application-pages-empty'
  | 'application-shell-invalid'
  | 'application-guard-invalid'

export interface LowcodeApplicationWarning {
  code: LowcodeApplicationWarningCode
  nodeId: string
  message: string
}

export interface ResolvedLowcodeApplicationPages {
  mode: 'legacy' | 'application' | 'invalid'
  pages: Array<{
    pageId: string
    entryNodeId?: string
    stateRetention?: LowcodeApplicationStateRetention
    enterGuard?: LowcodeApplicationEnterGuardV1
    leaveConfirm?: LowcodeApplicationLeaveConfirmV1
  }>
  warnings: LowcodeApplicationWarning[]
  shell?: LowcodeApplicationShellV1
}

function inertKey(node: SceneNode, key: string): boolean {
  return node.pluginData.some((entry) => entry.pluginId === 'open-pencil' && entry.key === key)
}

function editableVisible(node: SceneNode): boolean {
  return (
    node.visible &&
    !node.locked &&
    !node.internalOnly &&
    !node.libraryId &&
    !node.libraryReadonly &&
    !node.librarySource
  )
}

function applicationEntry(graph: SceneGraph, page: SceneNode, id: string | undefined) {
  const entry = id === undefined ? undefined : graph.getNode(id)
  if (
    page.type !== 'CANVAS' ||
    page.parentId !== graph.rootId ||
    page.lowcodeLibraryCache ||
    !editableVisible(page)
  )
    return undefined
  if (
    entry?.type !== 'FRAME' ||
    entry.parentId !== page.id ||
    !page.childIds.includes(entry.id) ||
    !editableVisible(entry)
  )
    return undefined
  return entry
}

function applicationRootOwner(graph: SceneGraph, root: SceneNode): boolean {
  return root.type === 'FRAME' && root.parentId === null && root.id === graph.rootId
}

function applicationShellPolicy(
  graph: SceneGraph,
  shell: LowcodeApplicationShellV1 | undefined,
  warnings: LowcodeApplicationWarning[]
): Pick<ResolvedLowcodeApplicationPages, 'shell'> {
  if (!shell) return {}
  const resolved = resolveLowcodeApplicationShell(graph, shell)
  if (!resolved.ok)
    warnings.push({
      code: 'application-shell-invalid',
      nodeId: resolved.nodeId,
      message: resolved.reason
    })
  return { shell }
}

function applicationScopePage(
  pageId: string,
  entryNodeId: string,
  policy: LowcodeApplicationPageV1
): ResolvedLowcodeApplicationPages['pages'][number] {
  const page: ResolvedLowcodeApplicationPages['pages'][number] = { pageId, entryNodeId }
  if (policy.stateRetention !== undefined) page.stateRetention = policy.stateRetention
  if (policy.enterGuard !== undefined) page.enterGuard = policy.enterGuard
  if (policy.leaveConfirm !== undefined) page.leaveConfirm = policy.leaveConfirm
  return page
}

function applicationScopeGuardRoutes(
  graph: SceneGraph,
  pages: ResolvedLowcodeApplicationPages['pages']
) {
  if (!pages.some((page) => page.enterGuard)) return { ok: true as const }
  const routes = deriveLowcodePageRoutes(
    pages.map(({ pageId }) => {
      const page = graph.getNode(pageId)
      return {
        pageId,
        pageName: page?.name ?? '',
        ...(page?.lowcodeRoutePattern ? { routePattern: page.lowcodeRoutePattern } : {})
      }
    })
  )
  return validateLowcodeApplicationGuardRoutes(
    pages.map((page) => ({
      pageId: page.pageId,
      route: routes.find((route) => route.pageId === page.pageId)?.route ?? '',
      ...(page.enterGuard ? { enterGuard: page.enterGuard } : {})
    }))
  )
}

/** Shared page scope/order projection. Warnings remain explicit; callers decide how to present them.
 * No node is mutated, migrated or deleted. An explicit requested subset is never expanded. */
export function resolveLowcodeApplicationPages(
  graph: SceneGraph,
  pageIds?: readonly string[]
): ResolvedLowcodeApplicationPages {
  const requested = pageIds === undefined ? graph.getPages().map((page) => page.id) : [...pageIds]
  const legacy: ResolvedLowcodeApplicationPages = {
    mode: 'legacy',
    pages: requested.map((pageId) => ({ pageId })),
    warnings: []
  }
  const root = graph.getNode(graph.rootId)
  if (!root) return legacy
  const warnings: LowcodeApplicationWarning[] = []
  const warn = (code: LowcodeApplicationWarningCode, nodeId: string, message: string) =>
    warnings.push({ code, nodeId, message })
  if (inertKey(root, LOWCODE_APPLICATION_PLUGIN_KEY)) {
    warn('application-inert', root.id, 'Application policy is preserved as inert plugin data.')
    return { mode: 'invalid', pages: [], warnings }
  }
  if (root.lowcodeApplication === undefined) return legacy
  const validated = validateLowcodeApplication(root.lowcodeApplication)
  if (!validated.ok) {
    warn('application-invalid', root.id, validated.reason)
    return { mode: 'invalid', pages: [], warnings }
  }
  if (!validated.value.enabled) return legacy
  if (!applicationRootOwner(graph, root)) {
    warn('application-invalid', root.id, 'Application policy requires the document FRAME root.')
    return { mode: 'invalid', pages: [], warnings }
  }
  const shared = applicationShellPolicy(graph, validated.value.shell, warnings)
  const pages: ResolvedLowcodeApplicationPages['pages'] = []
  for (const pageId of requested) {
    const page = graph.getNode(pageId)
    if (!page) {
      warn('application-page-invalid', pageId, 'Requested application page does not exist.')
      continue
    }
    if (inertKey(page, LOWCODE_APPLICATION_PAGE_PLUGIN_KEY)) {
      warn('application-page-inert', pageId, 'Page policy is preserved as inert plugin data.')
      continue
    }
    if (page.lowcodeApplicationPage === undefined) continue
    const policy = validateLowcodeApplicationPage(page.lowcodeApplicationPage)
    if (!policy.ok) {
      warn('application-page-invalid', pageId, policy.reason)
      continue
    }
    if (policy.value.role !== 'application') continue
    const entry = applicationEntry(graph, page, policy.value.entryNodeId)
    if (!entry) {
      warn(
        'application-entry-invalid',
        pageId,
        'Application entry must be an editable visible direct FRAME.'
      )
      continue
    }
    pages.push(applicationScopePage(pageId, entry.id, policy.value))
  }
  const guardRoutes = applicationScopeGuardRoutes(graph, pages)
  if (!guardRoutes.ok) {
    warn('application-guard-invalid', guardRoutes.pageId, guardRoutes.reason)
    return { mode: 'invalid', pages: [], warnings, ...shared }
  }
  const start = validated.value.startPageId
  if (start !== undefined) {
    const index = pages.findIndex((page) => page.pageId === start)
    if (index === -1)
      warn(
        'application-start-invalid',
        root.id,
        'Start page is not a valid requested application page.'
      )
    else if (index > 0) pages.unshift(...pages.splice(index, 1))
  }
  if (pages.length === 0)
    warn(
      'application-pages-empty',
      root.id,
      'Application mode has no valid requested application pages.'
    )
  return { mode: 'application', pages, warnings, ...shared }
}
