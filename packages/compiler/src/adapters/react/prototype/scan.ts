import type {
  ComponentDef,
  IRComponentRef,
  IRNode,
  IRPrototypeAction,
  IRPrototypeConnection,
  IRPrototypeTransition
} from '#compiler/ir/types'
import type { CompileWarning } from '#compiler/types'

import { easingCss } from '../motion/key'
import type { PagePathInfo } from '../route-paths'
import { buildPrototypeRuntime } from './runtime'
import type {
  ReactPrototypeAction,
  ReactPrototypeConnection,
  ReactPrototypeManifest,
  ReactPrototypePlan,
  ReactPrototypeTransition
} from './types'

/** Resolve framework-neutral prototype IR into routes plus a zero-dependency
 * browser runtime. No SceneGraph access occurs in this adapter pass. */
export function buildPrototypePlan(
  infos: readonly PagePathInfo[],
  components: readonly ComponentDef[] = []
): ReactPrototypePlan {
  const warnings: CompileWarning[] = []
  const prototypeComponentNames = new Set<string>()
  const pageRoutes = Object.fromEntries(infos.map((info) => [info.pageId, info.route]))
  const pageTransitionKeys: Record<string, string[]> = {}
  const overlayTransitionKeys: Record<string, string[]> = {}
  const connections: ReactPrototypeConnection[] = []

  const componentsByName = new Map<string, ComponentDef>()
  for (const component of components) componentsByName.set(component.name, component)

  for (const info of infos) {
    const pageKeys: string[] = []
    if (info.ir.transitionKey) pageKeys.push(info.ir.transitionKey)
    if (info.ir.prototype) {
      connections.push(
        ...lowerConnections(
          info.ir.prototype.connections,
          info.pageId,
          info.pageId,
          pageRoutes,
          warnings
        )
      )
    }
    for (const node of info.ir.children) {
      scanNode(node, {
        pageId: info.pageId,
        pageRoutes,
        warnings,
        connections,
        prototypeComponentNames,
        pageKeys,
        overlayTransitionKeys,
        componentsByName,
        componentStack: []
      })
    }
    pageTransitionKeys[info.pageId] = pageKeys
  }

  const manifest: ReactPrototypeManifest = {
    connections,
    pageRoutes,
    pageTransitionKeys,
    overlayTransitionKeys
  }
  return {
    runtime: connections.length > 0 ? buildPrototypeRuntime(manifest) : undefined,
    warnings,
    prototypeComponentNames
  }
}

interface PrototypeScanContext {
  pageId: string
  pageRoutes: Readonly<Record<string, string>>
  warnings: CompileWarning[]
  connections: ReactPrototypeConnection[]
  prototypeComponentNames: Set<string>
  pageKeys: string[]
  overlayTransitionKeys: Record<string, string[]>
  componentsByName: ReadonlyMap<string, ComponentDef>
  componentScope?: string
  componentStack: readonly string[]
  overlayRootId?: string
}

function scanNode(node: IRNode, ctx: PrototypeScanContext): void {
  if (node.kind === 'conditional') {
    scanNode(node.consequent, ctx)
    return
  }
  if (node.kind === 'list') {
    scanNode(node.template, ctx)
    return
  }
  if (node.kind !== 'element' && node.kind !== 'componentRef') return

  const identity = resolvePrototypeIdentity(node, ctx)
  if (!identity) return
  const { scope, sourceNodeId } = identity
  const overlayRootId = collectTransitionIdentity(node, ctx, sourceNodeId, scope)
  collectNodeConnections(node, ctx, sourceNodeId, scope)
  if (node.kind === 'componentRef' && hasPrototypeBoundaryDecoration(node)) {
    ctx.prototypeComponentNames.add(node.name)
  }
  if (node.kind === 'element') {
    for (const child of node.children) {
      scanNode(child, { ...ctx, overlayRootId })
    }
    return
  }
  scanComponentBody(node, { ...ctx, overlayRootId }, sourceNodeId)
}

function resolvePrototypeIdentity(
  node: Extract<IRNode, { kind: 'element' | 'componentRef' }>,
  ctx: PrototypeScanContext
): { sourceNodeId: string; scope?: string } | undefined {
  const scope = node.prototypeScope ? ctx.componentScope : undefined
  if (node.prototypeScope && !scope) {
    ctx.warnings.push({
      code: 'prototype-component-scope-unresolved',
      message: `prototype node ${node.sourceId} has no component instance scope and was dropped`,
      nodeId: node.sourceId
    })
    return undefined
  }
  return {
    sourceNodeId: scope ? scopedPrototypeValue(scope, node.sourceId) : node.sourceId,
    ...(scope ? { scope } : {})
  }
}

function collectTransitionIdentity(
  node: Extract<IRNode, { kind: 'element' | 'componentRef' }>,
  ctx: PrototypeScanContext,
  sourceNodeId: string,
  scope: string | undefined
): string | undefined {
  const isOverlayRoot = node.prototypeOverlayTarget === true
  const overlayRootId = isOverlayRoot ? sourceNodeId : ctx.overlayRootId
  if (isOverlayRoot) ctx.overlayTransitionKeys[sourceNodeId] = []
  if (node.transitionKey) {
    const transitionKey = scope
      ? scopedPrototypeValue(scope, node.transitionKey)
      : node.transitionKey
    if (overlayRootId) ctx.overlayTransitionKeys[overlayRootId]?.push(transitionKey)
    else ctx.pageKeys.push(transitionKey)
  }
  return overlayRootId
}

function collectNodeConnections(
  node: Extract<IRNode, { kind: 'element' | 'componentRef' }>,
  ctx: PrototypeScanContext,
  sourceNodeId: string,
  scope: string | undefined
): void {
  if (node.prototype) {
    ctx.connections.push(
      ...lowerConnections(
        node.prototype.connections,
        sourceNodeId,
        ctx.pageId,
        ctx.pageRoutes,
        ctx.warnings,
        scope
      )
    )
  }
}

function hasPrototypeBoundaryDecoration(node: IRComponentRef): boolean {
  return Boolean(
    node.prototype || node.transitionKey || node.prototypeTarget || node.prototypeOverlayTarget
  )
}

function scanComponentBody(
  node: IRComponentRef,
  ctx: PrototypeScanContext,
  sourceNodeId: string
): void {
  if (!node.prototypeBody) return
  const component = ctx.componentsByName.get(node.name)
  if (!component) {
    ctx.warnings.push({
      code: 'prototype-component-definition-unresolved',
      message: `prototype component ${node.name} has no emitted definition and its body was dropped`,
      nodeId: node.sourceId
    })
    return
  }
  if (ctx.componentStack.includes(node.name)) {
    ctx.warnings.push({
      code: 'prototype-component-cycle',
      message: `prototype component cycle ${[...ctx.componentStack, node.name].join(' -> ')} was dropped`,
      nodeId: node.sourceId
    })
    return
  }
  const componentScope = node.componentScope ? sourceNodeId : node.sourceId
  const next: PrototypeScanContext = {
    ...ctx,
    componentScope,
    componentStack: [...ctx.componentStack, node.name]
  }
  for (const child of selectedComponentBody(node, component)) scanNode(child, next)
}

function selectedComponentBody(node: IRComponentRef, component: ComponentDef): readonly IRNode[] {
  if (!component.variantAxes || !component.variants) return component.children
  const selected = new Map(
    node.props
      .filter((prop) => prop.kind === 'variant' && typeof prop.value === 'string')
      .map((prop) => [prop.name, prop.value as string])
  )
  const key = component.variantAxes
    .map((axis) => selected.get(axis.name) ?? axis.defaultValue)
    .join('|')
  const matching = component.variants.find((variant) => variant.key === key)
  if (matching) return matching.children
  return component.variants.at(0)?.children ?? []
}

function scopedPrototypeValue(scope: string, value: string): string {
  return JSON.stringify([scope, value])
}

function lowerConnections(
  source: readonly IRPrototypeConnection[],
  sourceNodeId: string,
  sourcePageId: string,
  pageRoutes: Readonly<Record<string, string>>,
  warnings: CompileWarning[],
  componentScope?: string
): ReactPrototypeConnection[] {
  return source.flatMap((connection) => {
    const action = lowerAction(
      connection.action,
      sourceNodeId,
      connection.id,
      pageRoutes,
      warnings,
      componentScope
    )
    return action
      ? [
          {
            id: componentScope
              ? scopedPrototypeValue(componentScope, connection.id)
              : connection.id,
            sourceNodeId,
            sourcePageId,
            trigger: connection.trigger,
            action,
            transition: lowerTransition(connection.transition),
            interruption: connection.interruption,
            playback: connection.playback
          }
        ]
      : []
  })
}

function lowerAction(
  action: IRPrototypeAction,
  sourceNodeId: string,
  connectionId: string,
  pageRoutes: Readonly<Record<string, string>>,
  warnings: CompileWarning[],
  componentScope?: string
): ReactPrototypeAction | undefined {
  if (action.kind === 'back' || action.kind === 'closeOverlay') return { kind: action.kind }
  const targetNodeId = resolveRuntimeTargetId(action.target, componentScope)
  if (!targetNodeId) {
    warnings.push({
      code: 'prototype-component-target-scope-unresolved',
      message: `prototype connection ${connectionId} target ${action.target.nodeId} has no resolvable component instance scope`,
      nodeId: sourceNodeId
    })
    return undefined
  }
  if (action.kind === 'openOverlay') {
    return {
      kind: action.kind,
      targetNodeId,
      placement: action.placement,
      dismissOnOutside: action.dismissOnOutside
    }
  }
  const route = pageRoutes[action.target.pageId]
  if (!route) {
    warnings.push({
      code: 'prototype-target-not-compiled',
      message: `prototype connection ${connectionId} target page ${action.target.pageId} is not included in this compile`,
      nodeId: sourceNodeId
    })
    return undefined
  }
  if (route.includes(':')) {
    warnings.push({
      code: 'prototype-dynamic-route-target-unsupported',
      message: `prototype connection ${connectionId} targets dynamic route ${route} without route parameters and was dropped`,
      nodeId: sourceNodeId
    })
    return undefined
  }
  return {
    kind: action.kind,
    route,
    targetNodeId,
    targetPageId: action.target.pageId,
    targetKind: action.target.kind
  }
}

function resolveRuntimeTargetId(
  target: Extract<IRPrototypeAction, { kind: 'navigate' | 'openOverlay' }>['target'],
  componentScope: string | undefined
): string | undefined {
  if (!target.componentPath) return target.nodeId
  let scope = target.componentRootNodeId ?? componentScope
  if (!scope) return undefined
  for (const segment of target.componentPath) scope = scopedPrototypeValue(scope, segment)
  return scope
}

function lowerTransition(transition: IRPrototypeTransition): ReactPrototypeTransition {
  if (transition.kind === 'instant') return transition
  return { ...transition, easing: easingCss(transition.easing) }
}
