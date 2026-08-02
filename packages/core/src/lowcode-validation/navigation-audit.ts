import type {
  ActionDef,
  EventName,
  NavigateAction,
  SceneGraph,
  SceneNode,
  WorkflowDef
} from '@open-pencil/scene-graph'

import { parseExpression } from './expression'
import {
  deriveLowcodePageRoutes,
  inspectLowcodeRouteParameters,
  lowcodeNavigationPathname,
  lowcodeRouteCollisionKey,
  lowcodeRouteMatches,
  type LowcodePageRouteInfo,
  type LowcodeRouteParameter
} from './routes'

export type NavigationEdgeStatus = 'ok' | 'missing' | 'ambiguous' | 'invalid'

export type NavigationAuditIssueCode =
  | 'route-pattern-invalid'
  | 'route-parameter-invalid'
  | 'route-collision'
  | 'navigate-target-missing'
  | 'navigate-target-invalid'
  | 'navigate-target-ambiguous'
  | 'navigate-param-missing'
  | 'navigate-param-extra'
  | 'navigate-param-invalid'
  | 'workflow-missing'
  | 'workflow-cycle'
  | 'button-no-events'

export interface NavigationAuditIssue {
  code: NavigationAuditIssueCode
  severity: 'error' | 'warning'
  message: string
  pageId?: string
  nodeId?: string
  actionId?: string
  eventName?: EventName
  route?: string
  relatedPageIds?: string[]
}

export interface NavigationRouteEntry extends LowcodePageRouteInfo {
  authoredRoutePattern?: string
  parameters: LowcodeRouteParameter[]
}

export interface NavigationRouteCollision {
  kind: 'exact' | 'dynamic-shape'
  routeKey: string
  routes: string[]
  pageIds: string[]
}

export interface NavigationEdge {
  sourcePageId: string
  sourceNodeId: string
  sourceNodeName: string
  eventName: EventName
  actionId: string
  actionPath: string
  to?: string
  params?: Record<string, string>
  status: NavigationEdgeStatus
  targetPageIds: string[]
  missingParams?: string[]
  extraParams?: string[]
  invalidParams?: string[]
}

export interface NavigationNoEventButton {
  pageId: string
  nodeId: string
  name: string
}

export interface NavigationAuditResult {
  summary: {
    pages: number
    edges: number
    okEdges: number
    missingEdges: number
    ambiguousEdges: number
    invalidEdges: number
    collisions: number
    noEventButtons: number
    errors: number
    warnings: number
  }
  routes: NavigationRouteEntry[]
  edges: NavigationEdge[]
  collisions: NavigationRouteCollision[]
  noEventButtons: NavigationNoEventButton[]
  issues: NavigationAuditIssue[]
}

export interface NavigationAuditOptions {
  /** Ordered pages that will exist in the compiled router. Omit for the full document. */
  pageIds?: readonly string[]
  /** Restrict source controls/edges to one page while retaining the full route manifest. */
  pageId?: string
  /** Expand document workflows reached by a callWorkflow action. Default true. */
  includeWorkflows?: boolean
}

interface ActionSource {
  pageId: string
  nodeId: string
  nodeName: string
  eventName: EventName
}

interface AuditState {
  routes: NavigationRouteEntry[]
  workflows: ReadonlyMap<string, WorkflowDef>
  includeWorkflows: boolean
  edges: NavigationEdge[]
  issues: NavigationAuditIssue[]
}

/** Analyze the effective compiler route manifest and every reachable navigate
 * action in the selected document/page scope. The function is pure with respect
 * to the SceneGraph and is shared by the MCP tool and compiler diagnostics. */
export function auditLowcodeNavigation(
  graph: SceneGraph,
  options: NavigationAuditOptions = {}
): NavigationAuditResult {
  const documentPages = graph.getPages()
  const pageById = new Map(documentPages.map((page) => [page.id, page]))
  const pages = options.pageIds
    ? options.pageIds.flatMap((pageId) => {
        const page = pageById.get(pageId)
        return page ? [page] : []
      })
    : documentPages
  const routes = buildRouteManifest(pages)
  const issues: NavigationAuditIssue[] = []
  const collisions = collectRouteCollisions(routes, issues)
  collectRouteIssues(routes, issues)

  const root = graph.getNode(graph.rootId)
  const workflows = new Map(
    (root?.lowcodeWorkflows ?? []).map((workflow) => [workflow.id, workflow])
  )
  const state: AuditState = {
    routes,
    workflows,
    includeWorkflows: options.includeWorkflows !== false,
    edges: [],
    issues
  }
  const noEventButtons: NavigationNoEventButton[] = []
  for (const page of pages) {
    if (options.pageId !== undefined && page.id !== options.pageId) continue
    auditPage(graph, page, state, noEventButtons)
  }

  return {
    summary: buildSummary(routes, state.edges, collisions, noEventButtons, issues),
    routes,
    edges: state.edges,
    collisions,
    noEventButtons,
    issues
  }
}

function buildRouteManifest(pages: readonly SceneNode[]): NavigationRouteEntry[] {
  const derived = deriveLowcodePageRoutes(
    pages.map((page) => ({
      pageId: page.id,
      pageName: page.name,
      routePattern: page.lowcodeRoutePattern
    }))
  )
  return derived.map((route, index) => ({
    ...route,
    ...(pages[index].lowcodeRoutePattern !== undefined
      ? { authoredRoutePattern: pages[index].lowcodeRoutePattern }
      : {}),
    parameters: inspectLowcodeRouteParameters(route.route).parameters
  }))
}

function collectRouteIssues(
  routes: readonly NavigationRouteEntry[],
  issues: NavigationAuditIssue[]
): void {
  for (const route of routes) {
    if (route.routePatternError) {
      issues.push({
        code: 'route-pattern-invalid',
        severity: 'error',
        message: `Page "${route.pageName}" has an invalid route pattern: ${route.routePatternError}; compiler falls back to "${route.route}"`,
        pageId: route.pageId,
        route: route.authoredRoutePattern
      })
    }
    for (const message of inspectLowcodeRouteParameters(route.route).issues) {
      issues.push({
        code: 'route-parameter-invalid',
        severity: 'error',
        message: `Page "${route.pageName}" route "${route.route}" has ${message}`,
        pageId: route.pageId,
        route: route.route
      })
    }
  }
}

function collectRouteCollisions(
  routes: readonly NavigationRouteEntry[],
  issues: NavigationAuditIssue[]
): NavigationRouteCollision[] {
  const groups = new Map<string, NavigationRouteEntry[]>()
  for (const route of routes) {
    const key = lowcodeRouteCollisionKey(route.route)
    const group = groups.get(key) ?? []
    group.push(route)
    groups.set(key, group)
  }
  const collisions: NavigationRouteCollision[] = []
  for (const [routeKey, group] of groups) {
    if (group.length < 2) continue
    const distinctRoutes = [...new Set(group.map((route) => route.route))]
    const collision: NavigationRouteCollision = {
      kind: distinctRoutes.length === 1 ? 'exact' : 'dynamic-shape',
      routeKey,
      routes: distinctRoutes,
      pageIds: group.map((route) => route.pageId)
    }
    collisions.push(collision)
    issues.push({
      code: 'route-collision',
      severity: 'error',
      message: `Routes ${distinctRoutes.map((route) => `"${route}"`).join(', ')} resolve to the same route shape`,
      route: distinctRoutes[0],
      relatedPageIds: collision.pageIds
    })
  }
  return collisions
}

function auditPage(
  graph: SceneGraph,
  page: SceneNode,
  state: AuditState,
  noEventButtons: NavigationNoEventButton[]
): void {
  const stack = page.childIds.map((nodeId) => ({ nodeId, inForm: false }))
  while (stack.length > 0) {
    const entry = stack.pop()
    if (entry === undefined) break
    const node = graph.getNode(entry.nodeId)
    if (!node) continue
    const descendantsInForm = entry.inForm || node.type === 'FORM'
    stack.push(...node.childIds.map((nodeId) => ({ nodeId, inForm: descendantsInForm })))
    if (node.type === 'BUTTON' && !entry.inForm && !hasConfiguredButtonInteraction(node)) {
      const button = { pageId: page.id, nodeId: node.id, name: node.name }
      noEventButtons.push(button)
      state.issues.push({
        code: 'button-no-events',
        severity: 'warning',
        message: `BUTTON "${node.name}" has no configured event actions`,
        pageId: page.id,
        nodeId: node.id
      })
    }
    collectNodeActions(node, page.id, state)
  }
}

function hasConfiguredEvent(node: SceneNode): boolean {
  return Object.values(node.events ?? {}).some((actions) => actions.length > 0)
}

function hasConfiguredButtonInteraction(node: SceneNode): boolean {
  if (hasConfiguredEvent(node)) return true
  return (
    node.prototype?.connections.some((connection) => connection.trigger.kind === 'click') === true
  )
}

function collectNodeActions(node: SceneNode, pageId: string, state: AuditState): void {
  for (const [eventName, actions] of Object.entries(node.events ?? {})) {
    const source: ActionSource = {
      pageId,
      nodeId: node.id,
      nodeName: node.name,
      eventName: eventName as EventName
    }
    collectActions(actions, source, `events.${eventName}`, state, new Set())
  }
}

function collectActions(
  actions: readonly ActionDef[],
  source: ActionSource,
  path: string,
  state: AuditState,
  workflowStack: ReadonlySet<string>
): void {
  actions.forEach((action, index) => {
    const actionPath = `${path}[${index}]`
    if (action.kind === 'navigate') collectNavigate(action, source, actionPath, state)
    if (action.kind === 'callWorkflow' && state.includeWorkflows) {
      collectWorkflow(action.workflowId, action, source, actionPath, state, workflowStack)
    }
    for (const branch of actionBranches(action)) {
      collectActions(branch.actions, source, `${actionPath}.${branch.name}`, state, workflowStack)
    }
  })
}

function collectWorkflow(
  workflowId: string | undefined,
  action: ActionDef,
  source: ActionSource,
  path: string,
  state: AuditState,
  workflowStack: ReadonlySet<string>
): void {
  if (!workflowId || !state.workflows.has(workflowId)) {
    state.issues.push({
      code: 'workflow-missing',
      severity: 'error',
      message: `callWorkflow action references missing workflow "${workflowId ?? ''}"`,
      pageId: source.pageId,
      nodeId: source.nodeId,
      eventName: source.eventName,
      actionId: action.id
    })
    return
  }
  if (workflowStack.has(workflowId)) {
    state.issues.push({
      code: 'workflow-cycle',
      severity: 'error',
      message: `Workflow cycle detected while expanding "${workflowId}"`,
      pageId: source.pageId,
      nodeId: source.nodeId,
      eventName: source.eventName,
      actionId: action.id
    })
    return
  }
  const workflow = state.workflows.get(workflowId)
  if (!workflow) return
  const nextStack = new Set(workflowStack)
  nextStack.add(workflowId)
  collectActions(workflow.actions, source, `${path}.workflow(${workflowId})`, state, nextStack)
}

function actionBranches(action: ActionDef): Array<{ name: string; actions: ActionDef[] }> {
  if (action.kind === 'condition' || action.kind === 'confirm') {
    return [
      { name: 'consequent', actions: action.consequent },
      ...(action.alternate ? [{ name: 'alternate', actions: action.alternate }] : [])
    ]
  }
  if (
    action.kind === 'apiCall' ||
    action.kind === 'supabaseQuery' ||
    action.kind === 'supabaseMutation'
  ) {
    return [
      ...(action.onSuccess ? [{ name: 'onSuccess', actions: action.onSuccess }] : []),
      ...(action.onError ? [{ name: 'onError', actions: action.onError }] : [])
    ]
  }
  return []
}

function collectNavigate(
  action: NavigateAction,
  source: ActionSource,
  actionPath: string,
  state: AuditState
): void {
  const to = typeof action.to === 'string' ? action.to.trim() : ''
  const edge: NavigationEdge = {
    sourcePageId: source.pageId,
    sourceNodeId: source.nodeId,
    sourceNodeName: source.nodeName,
    eventName: source.eventName,
    actionId: action.id,
    actionPath,
    ...(to ? { to } : {}),
    ...(action.params !== undefined ? { params: action.params } : {}),
    status: 'invalid',
    targetPageIds: []
  }
  state.edges.push(edge)
  if (to === '') {
    addEdgeIssue(state, edge, 'navigate-target-invalid', 'navigate action has no target route')
    return
  }
  if (!to.startsWith('/')) {
    addEdgeIssue(
      state,
      edge,
      'navigate-target-invalid',
      `navigate target "${to}" must start with "/"`
    )
    return
  }

  const pathname = lowcodeNavigationPathname(to)
  const exact = state.routes.filter((route) => route.route === pathname)
  const matches =
    exact.length > 0
      ? exact
      : state.routes.filter((route) => lowcodeRouteMatches(route.route, pathname))
  edge.targetPageIds = matches.map((route) => route.pageId)
  if (matches.length === 0) {
    edge.status = 'missing'
    addEdgeIssue(
      state,
      edge,
      'navigate-target-missing',
      `navigate target "${to}" does not resolve to a page`
    )
    return
  }
  if (matches.length > 1) {
    edge.status = 'ambiguous'
    addEdgeIssue(
      state,
      edge,
      'navigate-target-ambiguous',
      `navigate target "${to}" resolves to ${matches.length} pages`,
      matches.map((route) => route.pageId)
    )
    return
  }

  edge.status = 'ok'
  auditNavigateParams(action, pathname, matches[0], edge, state)
}

function auditNavigateParams(
  action: NavigateAction,
  pathname: string,
  target: NavigationRouteEntry,
  edge: NavigationEdge,
  state: AuditState
): void {
  const targetNames = new Set(target.parameters.map((parameter) => parameter.name))
  const supplied = action.params ?? {}
  const actionRouteInspection = inspectLowcodeRouteParameters(pathname)
  const targetsPattern = pathname === target.route || actionRouteInspection.parameters.length > 0
  const missing = targetsPattern
    ? target.parameters
        .filter((parameter) => !parameter.optional && !Object.hasOwn(supplied, parameter.name))
        .map((parameter) => parameter.name)
    : []
  const extra = Object.keys(supplied).filter((name) => !targetNames.has(name))
  const invalid = Object.entries(supplied)
    .filter(([, expression]) => {
      if (typeof expression !== 'string' || expression.trim() === '') return true
      return !parseExpression(expression.trim()).ok
    })
    .map(([name]) => name)
  if (actionRouteInspection.issues.length > 0) {
    edge.status = 'invalid'
    addEdgeIssue(
      state,
      edge,
      'navigate-param-invalid',
      `navigate target "${action.to}" has ${actionRouteInspection.issues.join('; ')}`
    )
  }
  if (missing.length > 0) {
    edge.status = 'invalid'
    edge.missingParams = missing
    addEdgeIssue(
      state,
      edge,
      'navigate-param-missing',
      `navigate target "${action.to}" is missing params: ${missing.join(', ')}`
    )
  }
  if (extra.length > 0) {
    edge.extraParams = extra
    addEdgeIssue(
      state,
      edge,
      'navigate-param-extra',
      `navigate target "${action.to}" has unknown params: ${extra.join(', ')}`
    )
  }
  if (invalid.length > 0) {
    edge.status = 'invalid'
    edge.invalidParams = invalid
    addEdgeIssue(
      state,
      edge,
      'navigate-param-invalid',
      `navigate target "${action.to}" has empty or invalid param expressions: ${invalid.join(', ')}`
    )
  }
}

function addEdgeIssue(
  state: AuditState,
  edge: NavigationEdge,
  code: NavigationAuditIssueCode,
  message: string,
  relatedPageIds?: string[]
): void {
  state.issues.push({
    code,
    severity: code === 'navigate-param-extra' ? 'warning' : 'error',
    message,
    pageId: edge.sourcePageId,
    nodeId: edge.sourceNodeId,
    actionId: edge.actionId,
    eventName: edge.eventName,
    route: edge.to,
    ...(relatedPageIds ? { relatedPageIds } : {})
  })
}

function buildSummary(
  routes: readonly NavigationRouteEntry[],
  edges: readonly NavigationEdge[],
  collisions: readonly NavigationRouteCollision[],
  noEventButtons: readonly NavigationNoEventButton[],
  issues: readonly NavigationAuditIssue[]
): NavigationAuditResult['summary'] {
  return {
    pages: routes.length,
    edges: edges.length,
    okEdges: edges.filter((edge) => edge.status === 'ok').length,
    missingEdges: edges.filter((edge) => edge.status === 'missing').length,
    ambiguousEdges: edges.filter((edge) => edge.status === 'ambiguous').length,
    invalidEdges: edges.filter((edge) => edge.status === 'invalid').length,
    collisions: collisions.length,
    noEventButtons: noEventButtons.length,
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length
  }
}
