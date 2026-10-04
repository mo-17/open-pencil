import {
  auditLowcodeNavigation,
  deriveLowcodePageRoutes,
  lowcodeRouteMatches,
  lowcodeNavigationPathname,
  validateLowcodeApplicationStartRoute
} from '@open-pencil/lowcode'
import {
  motionDriverNodeReferences,
  validateMotionDriverSpec,
  validateMotionSceneSpec,
  validatePrototypeSpec,
  type SceneGraph
} from '@open-pencil/scene-graph'

import type { ComponentDef, IREventHandler, IRNode, IRTree, IRWarning } from '../types'
import { shellBehaviorWarning } from './shell-projection'

type ApplicationSource = IRTree | Extract<IRNode, { kind: 'element' | 'componentRef' }>
type ReferenceCheck = (sourceId: string, targetId: string, kind: string) => void

/** Audit only emitted page nodes and component bodies reached by those pages. */
export function applicationReferenceWarnings(
  graph: SceneGraph,
  trees: readonly IRTree[],
  components: readonly ComponentDef[],
  shellNodeIds?: ReadonlySet<string>,
  componentWarnings: readonly IRWarning[] = []
): IRWarning[] {
  const warnings: IRWarning[] = []
  if (shellNodeIds) {
    const seen = new Set<string>()
    for (const warning of [...trees.flatMap((tree) => tree.warnings), ...componentWarnings]) {
      if (!warning.nodeId || !shellNodeIds.has(warning.nodeId)) continue
      const key = `${warning.nodeId}/${warning.code}/${warning.message}`
      if (seen.has(key)) continue
      seen.add(key)
      warnings.push(
        shellBehaviorWarning(
          warning.nodeId,
          `Shared shell behavior is unavailable (${warning.code}): ${warning.message}`
        )
      )
    }
  }
  const { allowed, sources } = collectApplicationSources(trees, components)
  const routes = deriveLowcodePageRoutes(trees)
  const seen = new Set<string>()
  const reference = (sourceId: string, targetId: string, kind: string): void => {
    if (allowed.has(targetId)) return
    const key = `${sourceId}/${kind}/${targetId}`
    if (seen.has(key)) return
    seen.add(key)
    warnings.push({
      code: 'application-reference-outside-entry',
      nodeId: sourceId,
      message: `${kind} references node ${JSON.stringify(targetId)} outside the emitted application entries; no application project was emitted.`
    })
  }
  for (const source of sources) {
    inspectAuthoredBoundary(graph, source, reference)
    inspectSourceReferences(source, reference, (sourceId, route) => {
      const pathname = lowcodeNavigationPathname(route)
      if (routes.some((candidate) => lowcodeRouteMatches(candidate.route, pathname))) return
      warnings.push({
        code: 'application-navigate-target-unavailable',
        nodeId: sourceId,
        message: `Navigate target ${JSON.stringify(route)} is not a selected application route; no application project was emitted.`
      })
    })
    if (
      shellNodeIds &&
      'sourceId' in source &&
      shellNodeIds.has(source.sourceId) &&
      'events' in source
    ) {
      for (const handlers of Object.values(source.events ?? {})) {
        if (handlersContainMotion(handlers))
          warnings.push(
            shellBehaviorWarning(
              source.sourceId,
              'Shared shell event actions cannot control Motion.'
            )
          )
      }
    }
  }
  warnings.push(...applicationRouteWarnings(graph, trees, routes))
  return warnings
}

function handlersContainMotion(handlers: readonly IREventHandler[]): boolean {
  return handlers.some(
    (handler) =>
      ['playMotion', 'stopMotion', 'toggleMotion', 'awaitMotion'].includes(handler.kind) ||
      ('consequent' in handler &&
        (handlersContainMotion(handler.consequent) ||
          handlersContainMotion(handler.alternate ?? []))) ||
      ('onSuccess' in handler && handlersContainMotion(handler.onSuccess ?? [])) ||
      ('onError' in handler && handlersContainMotion(handler.onError ?? []))
  )
}

/** Scope validation precedes lowerer's independent unsupported-feature omissions. */
function inspectAuthoredBoundary(
  graph: SceneGraph,
  source: ApplicationSource,
  reference: ReferenceCheck
): void {
  const sourceId = 'pageId' in source ? source.pageId : source.sourceId
  const node = graph.getNode(sourceId)
  if (!node) return
  const prototype = validatePrototypeSpec(node.prototype)
  if (prototype.success) {
    for (const connection of prototype.value.connections) {
      if (connection.trigger.kind === 'click' && (node.events?.onClick?.length ?? 0) > 0) continue
      if (connection.action.kind === 'navigate' || connection.action.kind === 'openOverlay')
        reference(sourceId, connection.action.targetNodeId, 'Prototype')
    }
  }
  const drivers = validateMotionDriverSpec(node.motionDrivers)
  if (drivers.success) {
    for (const target of motionDriverNodeReferences(drivers.value))
      reference(sourceId, target, 'Motion driver')
  }
  const scene = validateMotionSceneSpec(node.motionScene)
  if (scene.success) {
    for (const sequence of scene.value.sequences) {
      for (const cue of sequence.cues) {
        if (cue.enabled !== false) reference(sourceId, cue.targetNodeId, 'Motion scene')
      }
    }
  }
}

function collectApplicationSources(trees: readonly IRTree[], components: readonly ComponentDef[]) {
  const allowed = new Set(trees.map((tree) => tree.pageId))
  const sources: ApplicationSource[] = [...trees]
  const definitions = new Map(components.map((definition) => [definition.name, definition]))
  const visitedDefinitions = new Set<string>()
  const collect = (node: IRNode): void => {
    if (node.kind === 'conditional') return collect(node.consequent)
    if (node.kind === 'list') return collect(node.template)
    if (node.kind !== 'element' && node.kind !== 'componentRef') return
    sources.push(node)
    allowed.add(node.sourceId)
    if (node.kind === 'element') {
      for (const child of node.children) collect(child)
      return
    }
    if (visitedDefinitions.has(node.name)) return
    visitedDefinitions.add(node.name)
    const definition = definitions.get(node.name)
    if (!definition) return
    allowed.add(definition.componentId)
    for (const child of definition.children) collect(child)
    for (const variant of definition.variants ?? []) {
      for (const child of variant.children) collect(child)
    }
  }
  for (const tree of trees) {
    for (const child of tree.children) collect(child)
  }
  return { allowed, sources }
}

function inspectSourceReferences(
  source: ApplicationSource,
  reference: ReferenceCheck,
  navigate: (sourceId: string, route: string) => void
): void {
  const sourceId = 'pageId' in source ? source.pageId : source.sourceId
  for (const connection of source.prototype?.connections ?? []) {
    if (connection.action.kind === 'navigate' || connection.action.kind === 'openOverlay') {
      const target = connection.action.target
      reference(sourceId, target.componentRootNodeId ?? target.nodeId, 'Prototype')
    }
  }
  inspectMotionReferences(source, sourceId, reference)
  if ('events' in source) {
    for (const handlers of Object.values(source.events ?? {})) {
      inspectHandlers(handlers, sourceId, reference, (route) => {
        navigate(sourceId, route)
      })
    }
  }
}

function inspectMotionReferences(
  source: ApplicationSource,
  sourceId: string,
  reference: ReferenceCheck
): void {
  for (const driver of source.motionDrivers?.drivers ?? []) {
    reference(sourceId, driver.target.targetNodeId, 'Motion driver target')
    if ('sourceNodeId' in driver.source && driver.source.sourceNodeId) {
      reference(sourceId, driver.source.sourceNodeId, 'Motion driver source')
    }
    if (driver.source.kind === 'drag')
      reference(sourceId, driver.source.handleNodeId, 'Motion drag handle')
  }
  if ('motionScene' in source) {
    for (const sequence of source.motionScene?.sequences ?? []) {
      for (const cue of sequence.cues) reference(sourceId, cue.targetNodeId, 'Motion scene')
    }
  }
}

function applicationRouteWarnings(
  graph: SceneGraph,
  trees: readonly IRTree[],
  routes: ReturnType<typeof deriveLowcodePageRoutes>
): IRWarning[] {
  const warnings: IRWarning[] = []
  const start = routes.at(0)
  if (start && !validateLowcodeApplicationStartRoute(start.route).ok) {
    warnings.push({
      code: 'application-start-route-invalid',
      nodeId: start.pageId,
      message:
        'Application start route requires a concrete internal path without parameters, wildcards, query or fragment.'
    })
  }
  if (start && start.route !== '/' && routes.slice(1).some((route) => route.route === '/')) {
    warnings.push({
      code: 'application-start-route-conflict',
      nodeId: start.pageId,
      message: 'Application start redirect conflicts with another page authored at the root route.'
    })
  }
  for (const tree of trees) {
    if (!tree.warnings.some((warning) => warning.code === 'route-pattern-invalid')) continue
    warnings.push({
      code: 'application-route-invalid',
      nodeId: tree.pageId,
      message: 'Application route pattern is invalid; no fallback route was emitted.'
    })
  }
  for (const issue of auditLowcodeNavigation(graph, { pageIds: trees.map((tree) => tree.pageId) })
    .issues) {
    if (issue.severity !== 'error') continue
    warnings.push({
      code: 'application-navigation-invalid',
      nodeId: issue.nodeId ?? issue.pageId,
      message: `${issue.message}; no application project was emitted.`
    })
  }
  return warnings
}

function inspectHandlers(
  handlers: readonly IREventHandler[],
  sourceId: string,
  reference: (sourceId: string, targetId: string, kind: string) => void,
  navigate: (route: string) => void
): void {
  for (const handler of handlers) {
    if (handler.kind === 'navigate') navigate(handler.to)
    if (handler.kind === 'back') navigate(handler.fallback)
    if ('targetNodeId' in handler) reference(sourceId, handler.targetNodeId, 'Motion action')
    if (handler.kind === 'condition' || handler.kind === 'confirm') {
      inspectHandlers(handler.consequent, sourceId, reference, navigate)
      inspectHandlers(handler.alternate ?? [], sourceId, reference, navigate)
    }
    if ('onSuccess' in handler)
      inspectHandlers(handler.onSuccess ?? [], sourceId, reference, navigate)
    if ('onError' in handler) inspectHandlers(handler.onError ?? [], sourceId, reference, navigate)
  }
}
