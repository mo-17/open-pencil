import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { colorToHex } from '#core/color'

import { boundedEntries, briefBindings, type BriefBehavior } from './behavior'
import type { BriefBudget } from './budget'
import type { ScopedBriefNode } from './scope'
import type { DesignBriefNode, DesignBriefVariable } from './types'

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export function briefNode(
  graph: SceneGraph,
  entry: ScopedBriefNode,
  behavior: BriefBehavior,
  budget: BriefBudget
): DesignBriefNode {
  const { node, depth, parentId } = entry
  const result: DesignBriefNode = {
    id: budget.text(node.id),
    parentId: parentId ? budget.text(parentId) : null,
    depth,
    type: node.type,
    name: budget.text(node.name),
    visible: node.visible,
    geometry: {
      x: finite(node.x),
      y: finite(node.y),
      width: finite(node.width),
      height: finite(node.height),
      rotation: finite(node.rotation)
    },
    layout: {
      layoutMode: node.layoutMode,
      layoutWrap: node.layoutWrap,
      primaryAxisAlign: node.primaryAxisAlign,
      counterAxisAlign: node.counterAxisAlign,
      primaryAxisSizing: node.primaryAxisSizing,
      counterAxisSizing: node.counterAxisSizing,
      layoutPositioning: node.layoutPositioning,
      itemSpacing: finite(node.itemSpacing),
      paddingTop: finite(node.paddingTop),
      paddingRight: finite(node.paddingRight),
      paddingBottom: finite(node.paddingBottom),
      paddingLeft: finite(node.paddingLeft)
    },
    style: { fillTypes: [], solidColors: [], cornerRadius: finite(node.cornerRadius) },
    bindings: briefBindings(graph, node, budget),
    events: behavior.events(node),
    variableBindings: boundedEntries(node.boundVariables, budget).map(([property, variableId]) => ({
      property: budget.text(property),
      variableId: budget.text(variableId)
    })),
    responsive: [],
    motionScene: Boolean(node.motionScene),
    motionDrivers: Boolean(node.motionDrivers)
  }
  appendPresentation(node, result, budget)
  if (node.lowcodeRoutePattern) result.route = behavior.route(node.lowcodeRoutePattern)
  if (node.type === 'CANVAS') result.requiresAuth = Boolean(node.lowcodeRequiresAuth)
  for (const breakpoint of ['compact', 'sm', 'md', 'lg', 'xl'] as const) {
    const fields = boundedEntries(node.responsiveOverrides?.[breakpoint], budget).map(([field]) =>
      budget.text(field)
    )
    if (fields.length) result.responsive.push({ breakpoint, fields })
  }
  appendMotion(node, result, budget)
  appendModule(node, result, behavior, budget)
  return result
}

export function briefVariables(
  graph: SceneGraph,
  nodes: ScopedBriefNode[],
  budget: BriefBudget
): DesignBriefVariable[] {
  const result: DesignBriefVariable[] = []
  const seen = new Set<string>()
  for (const { node } of nodes) {
    for (const [, id] of boundedEntries(node.boundVariables, budget)) {
      if (seen.has(id)) continue
      seen.add(id)
      const variable = graph.variables.get(id)
      if (!variable) {
        budget.warnings.add('missing-reference')
        continue
      }
      const collection = graph.variableCollections.get(variable.collectionId)
      const modes: string[] = []
      for (const mode of collection?.modes ?? []) {
        if (!budget.detail()) break
        modes.push(budget.text(mode.name))
      }
      result.push({
        id: budget.text(id),
        name: budget.text(variable.name),
        type: variable.type,
        collectionName: budget.text(collection?.name ?? ''),
        modes
      })
    }
  }
  return result
}

function appendPresentation(node: SceneNode, result: DesignBriefNode, budget: BriefBudget): void {
  if (typeof node.interactiveProps?.text === 'string')
    result.text = budget.text(node.interactiveProps.text)
  if (node.type === 'TEXT') {
    result.text = budget.text(node.text)
    result.style.fontFamily = budget.text(node.fontFamily)
    result.style.fontSize = finite(node.fontSize)
    result.style.fontWeight = finite(node.fontWeight)
  }
  for (const fill of node.fills.slice(0, 8)) {
    if (!budget.detail()) break
    if (!fill.visible) continue
    result.style.fillTypes.push(fill.type)
    if (fill.type === 'SOLID') result.style.solidColors.push(colorToHex(fill.color))
  }
  if (node.fills.length > 8) budget.warnings.add('details-truncated')
}

function appendMotion(node: SceneNode, result: DesignBriefNode, budget: BriefBudget): void {
  if (node.motion) {
    const triggers: string[] = []
    for (const track of node.motion.tracks) {
      if (!budget.detail()) break
      const trigger = budget.text(track.trigger)
      if (!triggers.includes(trigger)) triggers.push(trigger)
    }
    result.motion = {
      version: node.motion.version,
      tracks: node.motion.tracks.length,
      triggers,
      reducedMotion: node.motion.reducedMotion ?? 'unspecified'
    }
  }
}

function appendModule(
  node: SceneNode,
  result: DesignBriefNode,
  behavior: BriefBehavior,
  budget: BriefBudget
): void {
  if (node.renderCondition) budget.warnings.add('expressions-omitted')
  if (node.lowcodeCustomCss || node.lowcodeHeadMetadata) budget.warnings.add('custom-code-omitted')
  const module = node.interactiveProps?.module
  if (
    typeof module === 'object' &&
    module !== null &&
    'pluginId' in module &&
    'moduleType' in module
  ) {
    if (typeof module.pluginId === 'string' && typeof module.moduleType === 'string') {
      result.module = {
        pluginId: budget.text(module.pluginId),
        moduleType: budget.text(module.moduleType)
      }
      budget.warnings.add('module-config-omitted')
    }
  }
  if (node.type !== 'LIST') return
  const dataSource = node.interactiveProps?.dataSourceRef
  if (
    typeof dataSource === 'object' &&
    dataSource !== null &&
    'kind' in dataSource &&
    dataSource.kind === 'backendResource' &&
    'resourceId' in dataSource &&
    typeof dataSource.resourceId === 'string'
  ) {
    behavior.resource(dataSource.resourceId, 'list')
  }
}
