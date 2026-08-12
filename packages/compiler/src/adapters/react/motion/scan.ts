import type { ComponentDef, IREventHandler, IRNode, IRTree } from '#compiler/ir/types'

import { buildMotionCSS } from './css'
import {
  buildMotionDriversRuntime,
  motionDriverToken,
  type ReactMotionDriverEntry
} from './drivers'
import { motionToken } from './key'
import { buildMotionRuntime } from './runtime'
import { buildMotionSceneRuntime } from './scene'
import type { ReactMotionEntry, ReactMotionPlan } from './types'

/** Collect, de-duplicate, and lower all reachable page/component motion assets. */
export function buildMotionPlan(
  irs: readonly IRTree[],
  components: readonly ComponentDef[],
  devMode = false
): ReactMotionPlan {
  const entries = new Map<string, ReactMotionEntry>()
  const driverEntries = new Map<string, ReactMotionDriverEntry>()
  const animatedComponentNames = new Set<string>()
  const eventComponentNames = new Set<string>()
  const motionScopeComponentNames = new Set<string>()
  // Keep traversal-derived flags on a mutable record. Besides accurately
  // reflecting closure writes, this prevents type-aware control-flow analysis
  // from treating the pre-traversal values as permanent constants.
  const runtimeUsage = { programmaticMotion: false, pageNavigation: false }
  const visit = (node: IRNode, ownerComponentName?: string): void => {
    if (node.kind === 'element' || node.kind === 'componentRef') {
      collectNodeMotionAssets(node, ownerComponentName, {
        entries,
        driverEntries,
        animatedComponentNames,
        motionScopeComponentNames
      })
      if (node.kind === 'componentRef' && hasEventHandlers(node.events)) {
        eventComponentNames.add(node.name)
      }
      if (node.kind === 'componentRef' && node.motionDriverMarker) {
        animatedComponentNames.add(node.name)
      }
      const usesMotionAction = eventsUseProgrammaticMotion(node.events)
      runtimeUsage.programmaticMotion ||= usesMotionAction
      runtimeUsage.pageNavigation ||= eventsUsePageNavigation(node.events)
      if (usesMotionAction) {
        if (ownerComponentName) motionScopeComponentNames.add(ownerComponentName)
        if (node.kind === 'componentRef') motionScopeComponentNames.add(node.name)
      }
      if (node.kind === 'element') {
        node.children.forEach((child) => visit(child, ownerComponentName))
      }
      return
    }
    if (node.kind === 'conditional') visit(node.consequent, ownerComponentName)
    else if (node.kind === 'list') visit(node.template, ownerComponentName)
  }

  for (const ir of irs) {
    if (ir.motion) {
      const token = motionToken(ir.motion)
      if (!entries.has(token)) entries.set(token, { token, motion: ir.motion })
    }
    if (ir.motionDrivers) {
      const token = motionDriverToken(ir.motionDrivers)
      if (!driverEntries.has(token)) {
        driverEntries.set(token, { token, spec: ir.motionDrivers })
      }
    }
    ir.children.forEach((child) => visit(child))
  }
  for (const component of components) {
    component.children.forEach((child) => visit(child, component.name))
    for (const variant of component.variants ?? []) {
      variant.children.forEach((child) => visit(child, component.name))
    }
  }

  const sortedEntries = [...entries.values()].sort((a, b) => a.token.localeCompare(b.token))
  const usesComposedMotion = sortedEntries.some((entry) => entry.motion.version === 3)
  const sortedDriverEntries = [...driverEntries.values()].sort((left, right) =>
    left.token.localeCompare(right.token)
  )
  const sceneRuntime = buildMotionSceneRuntime(irs, components)
  const usesMotionScenes = sceneRuntime !== ''
  const baseRuntime = buildMotionRuntime(
    sortedEntries,
    runtimeUsage.programmaticMotion || usesMotionScenes,
    devMode,
    runtimeUsage.pageNavigation ||
      usesComposedMotion ||
      sortedDriverEntries.length > 0 ||
      usesMotionScenes
  )
  return {
    css: buildMotionCSS(sortedEntries),
    runtime:
      baseRuntime === undefined
        ? undefined
        : baseRuntime + buildMotionDriversRuntime(sortedDriverEntries) + sceneRuntime,
    animatedComponentNames,
    eventComponentNames,
    motionScopeComponentNames
  }
}

type MotionAssetNode = Extract<IRNode, { kind: 'element' | 'componentRef' }>

interface MotionAssetCollector {
  entries: Map<string, ReactMotionEntry>
  driverEntries: Map<string, ReactMotionDriverEntry>
  animatedComponentNames: Set<string>
  motionScopeComponentNames: Set<string>
}

function collectNodeMotionAssets(
  node: MotionAssetNode,
  ownerComponentName: string | undefined,
  collector: MotionAssetCollector
): void {
  if (node.motion) {
    const token = motionToken(node.motion)
    if (!collector.entries.has(token)) {
      collector.entries.set(token, { token, motion: node.motion })
    }
    if (node.kind === 'componentRef') collector.animatedComponentNames.add(node.name)
  }
  if (!node.motionDrivers) return
  const token = motionDriverToken(node.motionDrivers)
  if (!collector.driverEntries.has(token)) {
    collector.driverEntries.set(token, { token, spec: node.motionDrivers })
  }
  if (ownerComponentName) collector.motionScopeComponentNames.add(ownerComponentName)
  if (node.kind === 'componentRef') {
    collector.animatedComponentNames.add(node.name)
    collector.motionScopeComponentNames.add(node.name)
  }
}

function hasEventHandlers(
  events: Extract<IRNode, { kind: 'element' | 'componentRef' }>['events']
): boolean {
  return Boolean(events && Object.values(events).some((handlers) => handlers.length > 0))
}

function eventsUseProgrammaticMotion(
  events: Extract<IRNode, { kind: 'element' | 'componentRef' }>['events']
): boolean {
  return eventsContain(events, (handler) =>
    (
      ['playMotion', 'stopMotion', 'toggleMotion', 'awaitMotion'] as IREventHandler['kind'][]
    ).includes(handler.kind)
  )
}

function handlerTreeContains(
  handler: IREventHandler,
  predicate: (candidate: IREventHandler) => boolean
): boolean {
  if (predicate(handler)) return true
  if (handler.kind === 'condition' || handler.kind === 'confirm') {
    return [...handler.consequent, ...(handler.alternate ?? [])].some((candidate) =>
      handlerTreeContains(candidate, predicate)
    )
  }
  if (
    handler.kind === 'apiCall' ||
    handler.kind === 'supabaseQuery' ||
    handler.kind === 'supabaseMutation' ||
    handler.kind === 'invokeServerWorkflow'
  ) {
    return [...(handler.onSuccess ?? []), ...(handler.onError ?? [])].some((candidate) =>
      handlerTreeContains(candidate, predicate)
    )
  }
  return false
}

function eventsContain(
  events: Extract<IRNode, { kind: 'element' | 'componentRef' }>['events'],
  predicate: (handler: IREventHandler) => boolean
): boolean {
  if (!events) return false
  return Object.values(events).some((handlers) =>
    handlers.some((handler) => handlerTreeContains(handler, predicate))
  )
}

function eventsUsePageNavigation(
  events: Extract<IRNode, { kind: 'element' | 'componentRef' }>['events']
): boolean {
  return eventsContain(events, (handler) => handler.kind === 'navigate')
}
