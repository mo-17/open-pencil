import {
  LOWCODE_APPLICATION_PAGE_PLUGIN_KEY,
  LOWCODE_APPLICATION_PLUGIN_KEY,
  validateLowcodeApplication,
  validateLowcodeApplicationPage,
  validateLowcodeApplicationStartRoute,
  validateLowcodeNavigationTarget,
  validateLowcodeRoutePattern
} from '@open-pencil/lowcode'
import type { PluginDataEntry, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { ApplicationModeEditor, ApplicationModeOption, ApplicationModeView } from './types'

export function applicationRawEntry(entry: PluginDataEntry, page: boolean): boolean {
  const key = page ? LOWCODE_APPLICATION_PAGE_PLUGIN_KEY : LOWCODE_APPLICATION_PLUGIN_KEY
  return entry.pluginId === 'open-pencil' && entry.key === key
}

function protectedNode(node: SceneNode): boolean {
  return (
    node.locked ||
    node.internalOnly ||
    node.lowcodeLibraryCache ||
    node.libraryReadonly ||
    !!node.libraryId ||
    !!node.librarySource
  )
}

export function applicationDocumentEditable(graph: SceneGraph): boolean {
  const root = graph.getNode(graph.rootId)
  return !!root && root.type === 'FRAME' && root.parentId === null && !protectedNode(root)
}

export function applicationPageEditable(graph: SceneGraph, page: SceneNode): boolean {
  return (
    graph.getNode(page.id) === page &&
    page.type === 'CANVAS' &&
    page.parentId === graph.rootId &&
    page.visible &&
    graph.getPages().includes(page) &&
    applicationDocumentEditable(graph) &&
    !protectedNode(page)
  )
}

export function applicationEntryEligible(
  graph: SceneGraph,
  page: SceneNode,
  node: SceneNode | undefined
): node is SceneNode {
  return (
    !!node &&
    applicationPageEditable(graph, page) &&
    graph.getNode(node.id) === node &&
    node.type === 'FRAME' &&
    node.parentId === page.id &&
    page.childIds.includes(node.id) &&
    node.visible &&
    !protectedNode(node)
  )
}

export function applicationStartEligible(graph: SceneGraph, page: SceneNode): boolean {
  const result = validateLowcodeApplicationPage(page.lowcodeApplicationPage)
  return (
    result.ok &&
    result.value.role === 'application' &&
    !page.pluginData.some((entry) => applicationRawEntry(entry, true)) &&
    applicationEntryEligible(graph, page, graph.getNode(result.value.entryNodeId ?? ''))
  )
}

export function applicationStartRouteValid(page: SceneNode): boolean {
  const route = page.lowcodeRoutePattern
  if (route !== undefined && typeof route !== 'string') return false
  return validateLowcodeApplicationStartRoute(route === undefined || route === '' ? '/' : route).ok
}

export function applicationRouteValid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 2048 &&
    (value === '' ||
      (validateLowcodeRoutePattern(value).ok && validateLowcodeNavigationTarget(value).ok))
  )
}

function readDocument(root: SceneNode | undefined) {
  const application = validateLowcodeApplication(root?.lowcodeApplication)
  const rootRaw = root?.pluginData.some((entry) => applicationRawEntry(entry, false)) ?? false
  return {
    enabled: application.ok && !rootRaw && application.value.enabled,
    startId: application.ok && !rootRaw ? (application.value.startPageId ?? '') : '',
    invalid: rootRaw || (root?.lowcodeApplication !== undefined && !application.ok)
  }
}

function readPage(page: SceneNode | undefined) {
  const pageConfig = validateLowcodeApplicationPage(page?.lowcodeApplicationPage)
  const pageRaw = page?.pluginData.some((entry) => applicationRawEntry(entry, true)) ?? false
  const policy = pageConfig.ok && !pageRaw ? pageConfig.value : undefined
  return {
    role: policy?.role ?? ('' as const),
    entryId: policy?.entryNodeId ?? '',
    route: typeof page?.lowcodeRoutePattern === 'string' ? page.lowcodeRoutePattern : '',
    stateRetention: policy?.stateRetention ?? ('' as const),
    enterGuard: policy?.enterGuard,
    leaveConfirm: policy?.leaveConfirm,
    invalid: pageRaw || (page?.lowcodeApplicationPage !== undefined && !pageConfig.ok)
  }
}

function selectionUnavailable(id: string, options: ApplicationModeOption[]): boolean {
  return id !== '' && !options.some((option) => option.value === id)
}

function entryOptions(graph: SceneGraph, page: SceneNode | undefined): ApplicationModeOption[] {
  if (!page) return []
  return graph
    .getChildren(page.id)
    .filter((node) => applicationEntryEligible(graph, page, node))
    .map((node) => ({ value: node.id, label: node.name }))
}

export function readApplicationMode(
  editor: ApplicationModeEditor | undefined
): ApplicationModeView {
  if (!editor)
    return {
      enabled: false,
      role: '',
      entryId: '',
      startId: '',
      startRouteInvalid: false,
      route: '',
      stateRetention: '',
      stateRetentionDisabled: true,
      enterGuard: undefined,
      leaveConfirm: undefined,
      guardsDisabled: true,
      invalid: false,
      modeDisabled: true,
      pageDisabled: true,
      entryDisabled: true,
      startDisabled: true,
      routeDisabled: true,
      entries: [],
      starts: []
    }
  const graph = editor.graph
  const page = graph.getNode(editor.state.currentPageId)
  const application = readDocument(graph.getNode(graph.rootId))
  const pageConfig = readPage(page)
  const entries = entryOptions(graph, page)
  const startPages = graph
    .getPages()
    .filter((candidate) => applicationStartEligible(graph, candidate))
  const starts = startPages.map((candidate) => ({
    value: candidate.id,
    label: candidate.name,
    ...(!applicationStartRouteValid(candidate) ? { disabled: true } : {})
  }))
  const startPage = application.startId
    ? startPages.find((candidate) => candidate.id === application.startId)
    : startPages[0]
  const startRouteInvalid =
    application.enabled && !!startPage && !applicationStartRouteValid(startPage)
  const modeDisabled = !applicationDocumentEditable(graph)
  const pageDisabled = !application.enabled || !page || !applicationPageEditable(graph, page)
  const unavailable =
    selectionUnavailable(pageConfig.entryId, entries) ||
    selectionUnavailable(application.startId, starts)
  return {
    ...application,
    ...pageConfig,
    startRouteInvalid,
    invalid: application.invalid || pageConfig.invalid || unavailable,
    modeDisabled,
    pageDisabled,
    entryDisabled: pageDisabled || pageConfig.role !== 'application',
    startDisabled: !application.enabled || modeDisabled,
    routeDisabled: pageDisabled || pageConfig.role !== 'application',
    stateRetentionDisabled: pageDisabled || pageConfig.role !== 'application' || pageConfig.invalid,
    guardsDisabled: pageDisabled || pageConfig.role !== 'application' || pageConfig.invalid,
    entries,
    starts
  }
}
