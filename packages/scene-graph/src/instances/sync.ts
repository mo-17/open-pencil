// Child cloning and property synchronization shared by instance creation, swap, and sync.
import { isEqual } from 'es-toolkit/predicate'

import type { ComponentPropertyReferenceField, SceneGraph, SceneNode } from '../'
import { ownsSlotContent, slotPropertyId } from '../components/slots'
import { cloneNodeProps, copyEffects, copyFills, copyStrokes, copyStyleRuns } from '../copy'
import type { NodeCloneMode } from '../copy'
import {
  getInstanceOverride,
  hasInstanceOverride as hasNodeInstanceOverride,
  setInstanceOverride,
  type InstanceOverrideState
} from '../instance-overrides'
import {
  cloneGeneratedEffectSpec,
  cloneMotionDriverSpec,
  cloneMotionSceneSpec,
  cloneMotionSpec,
  clonePrototypeSpec,
  parseMotionTransitionKey
} from '../motion'
import { scaleNodeChanges } from '../scaling/node'
import { scaleVariableBindingUnits } from '../variables/units'
import { INSTANCE_SYNC_FIELDS, OPTIONAL_INSTANCE_SYNC_PROPS } from './fields'

function setSceneProp<K extends keyof SceneNode>(
  target: Partial<SceneNode>,
  key: K,
  value: SceneNode[K]
): void {
  target[key] = value
}

function legacyOverrideKey(instanceId: string, nodeId: string, field: string): string {
  return nodeId === instanceId ? field : `${nodeId}:${field}`
}

export function hasProtectedInstanceOverride(
  overrides: InstanceOverrideState,
  legacyOverrides: Readonly<Record<string, unknown>>,
  instanceId: string,
  nodeId: string,
  field: string
): boolean {
  return (
    hasNodeInstanceOverride(overrides, instanceId, nodeId, field) ||
    Object.hasOwn(legacyOverrides, legacyOverrideKey(instanceId, nodeId, field))
  )
}

export function getCompatibleInstanceOverride(
  overrides: InstanceOverrideState,
  legacyOverrides: Readonly<Record<string, unknown>>,
  instanceId: string,
  nodeId: string,
  field: string
): unknown {
  const structured = getInstanceOverride(overrides, instanceId, nodeId, field)
  return structured !== undefined || hasNodeInstanceOverride(overrides, instanceId, nodeId, field)
    ? structured
    : legacyOverrides[legacyOverrideKey(instanceId, nodeId, field)]
}

function copyOptionalInstanceProp(
  target: Partial<SceneNode> | SceneNode,
  source: SceneNode,
  key: keyof SceneNode
): boolean {
  switch (key) {
    case 'motion':
      if (source.motion) setSceneProp(target, key, cloneMotionSpec(source.motion))
      else Reflect.deleteProperty(target, key)
      return true
    case 'motionScene':
      if (source.motionScene) setSceneProp(target, key, cloneMotionSceneSpec(source.motionScene))
      else Reflect.deleteProperty(target, key)
      return true
    case 'motionDrivers':
      if (source.motionDrivers) {
        setSceneProp(target, key, cloneMotionDriverSpec(source.motionDrivers))
      } else {
        Reflect.deleteProperty(target, key)
      }
      return true
    case 'prototype':
      if (source.prototype) setSceneProp(target, key, clonePrototypeSpec(source.prototype))
      else Reflect.deleteProperty(target, key)
      return true
    case 'transitionKey':
      if (source.transitionKey !== undefined) {
        setSceneProp(target, key, parseMotionTransitionKey(source.transitionKey))
      } else {
        Reflect.deleteProperty(target, key)
      }
      return true
    case 'generatedEffect':
      if (source.generatedEffect) {
        setSceneProp(target, key, cloneGeneratedEffectSpec(source.generatedEffect))
      } else {
        Reflect.deleteProperty(target, key)
      }
      return true
    default:
      return false
  }
}

export function copyProp(
  target: Partial<SceneNode> | SceneNode,
  source: SceneNode,
  key: keyof SceneNode
): void {
  if (copyOptionalInstanceProp(target, source, key)) return
  if (key === 'fills') {
    setSceneProp(target, key, copyFills(source.fills))
  } else if (key === 'strokes') {
    setSceneProp(target, key, copyStrokes(source.strokes))
  } else if (key === 'effects') {
    setSceneProp(target, key, copyEffects(source.effects))
  } else if (key === 'styleRuns') {
    setSceneProp(target, key, copyStyleRuns(source.styleRuns))
  } else if (key === 'boundVariables') {
    // Shallow copy the binding map — values are variable IDs (strings), not objects
    setSceneProp(target, key, { ...source.boundVariables })
    setSceneProp(target, 'variableBindingScales', { ...source.variableBindingScales })
  } else if (key === 'variableModes') {
    setSceneProp(target, key, { ...source.variableModes })
  } else if (key === 'gridPosition') {
    // Shallow copy the grid position object — all fields are primitives
    setSceneProp(target, key, source.gridPosition ? { ...source.gridPosition } : null)
  } else {
    const value = source[key]
    setSceneProp(target, key, Array.isArray(value) ? structuredClone(value) : value)
  }
}

export function bindingProtection(scopes: ReadonlySet<string>[]): (field: string) => boolean {
  const fields = new Set<string>()
  for (const scope of scopes) {
    const perField = [...scope].some((field) => field.startsWith('boundVariables/'))
    for (const field of scope) {
      if (field !== 'boundVariables' || !perField) fields.add(field)
    }
  }
  return (field) => fields.has(field)
}

export function syncBindingFields(
  target: SceneNode,
  source: SceneNode,
  updates: Partial<SceneNode>,
  protectedField: (field: string) => boolean
): void {
  if (protectedField('boundVariables')) return
  const bindings = { ...source.boundVariables }
  const scales = { ...source.variableBindingScales }
  for (const field of new Set([
    ...Object.keys(source.boundVariables),
    ...Object.keys(target.boundVariables),
    ...Object.keys(target.variableBindingScales)
  ])) {
    if (!protectedField(`boundVariables/${field}`)) continue
    if (!Object.hasOwn(target.boundVariables, field)) Reflect.deleteProperty(bindings, field)
    else bindings[field] = target.boundVariables[field]
    if (target.variableBindingScales[field] === undefined) Reflect.deleteProperty(scales, field)
    else scales[field] = target.variableBindingScales[field]
  }
  updates.boundVariables = bindings
  updates.variableBindingScales = scales
}

export function isProtectedSyncField(
  node: SceneNode,
  key: string,
  protectedField: (field: string) => boolean
): boolean {
  return (
    protectedField(key) ||
    (key in node.boundVariables &&
      (protectedField('boundVariables') || protectedField(`boundVariables/${key}`)))
  )
}

export function clearAbsentOptionalSyncFields(
  graph: SceneGraph,
  target: SceneNode,
  source: SceneNode,
  protectedField: (field: string) => boolean
): void {
  const fields = OPTIONAL_INSTANCE_SYNC_PROPS.filter(
    (key) =>
      target[key] !== undefined &&
      source[key] === undefined &&
      !isProtectedSyncField(target, key, protectedField)
  )
  if (fields.length) graph.clearNodeFields(target.id, fields)
}

export function legacyOverrideFields(
  legacy: Readonly<Record<string, unknown>>,
  instanceId: string,
  nodeId: string
): Set<string> {
  const prefix = `${nodeId}:`
  return new Set(
    Object.keys(legacy).flatMap((key) => {
      if (key.startsWith(prefix)) return [key.slice(prefix.length)]
      if (nodeId === instanceId && !key.includes(':')) return [key]
      return []
    })
  )
}

export function sourceInTargetCoordinates(source: SceneNode, targetScale: number): SceneNode {
  const factor = targetScale / source.componentScale
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('Invalid component coordinate scale')
  if (factor === 1) return source
  return {
    ...source,
    ...scaleNodeChanges(source, factor, true),
    ...scaleVariableBindingUnits(source, factor)
  }
}

export function updateSyncedProps(
  graph: SceneGraph,
  target: SceneNode,
  updates: Partial<SceneNode>
): void {
  const changed = Object.fromEntries(
    Object.entries(updates).filter(
      ([key, value]) => !isEqual(target[key as keyof SceneNode], value)
    )
  ) as Partial<SceneNode>
  if (Object.keys(changed).length) graph.updateNode(target.id, changed)
}

function cloneChildInCoordinates(
  graph: SceneGraph,
  src: SceneNode,
  sourceParent: SceneNode,
  targetParent: SceneNode,
  mode: NodeCloneMode = 'deep'
): SceneNode {
  const componentScale =
    (src.componentScale * targetParent.componentScale) / sourceParent.componentScale
  return graph.createNode(src.type, targetParent.id, {
    ...cloneNodeProps(sourceInTargetCoordinates(src, componentScale), src.id, mode),
    componentScale
  })
}

export function cloneChildrenWithMapping(
  graph: SceneGraph,
  sourceParentId: string,
  destParentId: string,
  mode: NodeCloneMode = 'deep',
  idMap?: Map<string, string>
): void {
  // Guard against cloning a subtree into itself or its own descendant. Without this,
  // a self-referential or cyclic component (e.g. an INSTANCE whose componentId points
  // to an ancestor) causes unbounded recursion and eventual stack overflow / OOM.
  if (sourceParentId === destParentId || graph.isDescendant(destParentId, sourceParentId)) return

  const ownsIdMap = idMap === undefined
  const cloneIdMap = idMap ?? new Map<string, string>()
  const sourceParent = graph.nodes.get(sourceParentId)
  const targetParent = graph.nodes.get(destParentId)
  if (!sourceParent || !targetParent) return

  for (const childId of sourceParent.childIds) {
    const src = graph.nodes.get(childId)
    if (!src) continue

    const clone = cloneChildInCoordinates(graph, src, sourceParent, targetParent, mode)
    cloneIdMap.set(src.id, clone.id)

    if (src.childIds.length > 0) {
      cloneChildrenWithMapping(graph, childId, clone.id, mode, cloneIdMap)
    }
  }
  if (ownsIdMap) graph.remapClonedNodeReferences(cloneIdMap, 'instance')
}

export function enclosingInstanceOverrideFields(graph: SceneGraph, node: SceneNode): Set<string>[] {
  const fields: Set<string>[] = []
  let parent = node.parentId ? graph.nodes.get(node.parentId) : undefined
  while (parent) {
    if (parent.type === 'INSTANCE') {
      fields.push(new Set(parent.instanceOverrides.descendants.get(node.id)?.keys()))
      fields.push(legacyOverrideFields(parent.overrides, parent.id, node.id))
    }
    parent = parent.parentId ? graph.nodes.get(parent.parentId) : undefined
  }
  return fields
}

/** SLOT_CONTENT is absent because it drives children, which `ownsSlotContent` keeps instead. */
const PROPERTY_REFERENCE_FIELDS: Partial<Record<ComponentPropertyReferenceField, string>> = {
  VISIBLE: 'visible',
  TEXT: 'text',
  INSTANCE_SWAP: 'componentId'
}

/** The nearest enclosing instance that assigns `propertyId`, if any does. */
function hasEnclosingAssignment(graph: SceneGraph, node: SceneNode, propertyId: string): boolean {
  let current: SceneNode | undefined = node
  while (current) {
    if (
      current.type === 'INSTANCE' &&
      Object.hasOwn(current.componentPropertyAssignments, propertyId)
    )
      return true
    current = current.parentId ? graph.nodes.get(current.parentId) : undefined
  }
  return false
}

/**
 * Fields a component property drives on this child. The component states the default, but
 * an enclosing instance's assignment decides the value, so synchronising must not copy the
 * default over it — a page loaded later would otherwise reset the instance to the default.
 */
function propertyDrivenFields(
  graph: SceneGraph,
  instChild: SceneNode,
  compChild: SceneNode
): Set<string> {
  const driven = new Set<string>()
  for (const reference of compChild.componentPropertyReferences) {
    const field = PROPERTY_REFERENCE_FIELDS[reference.field]
    if (field && hasEnclosingAssignment(graph, instChild, reference.propertyId)) driven.add(field)
  }
  return driven
}

function childBindingProtection(
  graph: SceneGraph,
  child: SceneNode,
  overrides: InstanceOverrideState,
  legacyOverrides: Readonly<Record<string, unknown>>,
  instanceId: string
) {
  const fields = enclosingInstanceOverrideFields(graph, child)
  fields.push(new Set(overrides.descendants.get(child.id)?.keys()))
  fields.push(legacyOverrideFields(legacyOverrides, instanceId, child.id))
  return bindingProtection(fields)
}

function linkMatchedChild(
  overrides: InstanceOverrideState,
  instParentId: string,
  instChild: SceneNode,
  compChildId: string
): void {
  if (instChild.type === 'INSTANCE') {
    setInstanceOverride(overrides, instParentId, instChild.id, 'sourceComponentId', compChildId)
  } else {
    instChild.componentId = compChildId
  }
}

function matchFallbackChildren(
  graph: SceneGraph,
  compParent: SceneNode,
  instParent: SceneNode,
  instParentId: string,
  overrides: InstanceOverrideState,
  instChildMap: Map<string, SceneNode>,
  usedInstChildIds: Set<string>
): void {
  const fallbackByType = new Map<SceneNode['type'], Map<string, SceneNode[]>>()
  const remainingCandidateCount = new Map<SceneNode['type'], number>()
  const unmatchedComponentCount = new Map<SceneNode['type'], number>()
  for (const compChildId of compParent.childIds) {
    if (instChildMap.has(compChildId)) continue
    const child = graph.nodes.get(compChildId)
    if (child) {
      unmatchedComponentCount.set(child.type, (unmatchedComponentCount.get(child.type) ?? 0) + 1)
    }
  }
  for (const childId of instParent.childIds) {
    const child = graph.nodes.get(childId)
    if (!child || usedInstChildIds.has(child.id)) continue
    remainingCandidateCount.set(child.type, (remainingCandidateCount.get(child.type) ?? 0) + 1)
    let byName = fallbackByType.get(child.type)
    if (!byName) {
      byName = new Map()
      fallbackByType.set(child.type, byName)
    }
    const queue = byName.get(child.name)
    if (queue) queue.push(child)
    else byName.set(child.name, [child])
  }

  // Match by name and type with FIFO queues to preserve sibling order in linear time.
  for (const compChildId of compParent.childIds) {
    if (instChildMap.has(compChildId)) continue
    const compChild = graph.nodes.get(compChildId)
    if (!compChild) continue
    const candidatesByName = fallbackByType.get(compChild.type)
    const candidateCount = remainingCandidateCount.get(compChild.type) ?? 0
    if (candidateCount > (unmatchedComponentCount.get(compChild.type) ?? 0)) continue
    const match = candidatesByName?.get(compChild.name)?.shift()
    if (!match) continue
    remainingCandidateCount.set(compChild.type, candidateCount - 1)
    instChildMap.set(compChildId, match)
    usedInstChildIds.add(match.id)
    linkMatchedChild(overrides, instParentId, match, compChildId)
  }
}

function sortInstanceChildren(
  graph: SceneGraph,
  instParent: SceneNode,
  _instParentId: string,
  compChildOrder: string[],
  overrides: InstanceOverrideState,
  legacyOverrides: Readonly<Record<string, unknown>>,
  instanceId: string
): void {
  const orderMap = new Map<string, number>()
  for (let i = 0; i < compChildOrder.length; i++) orderMap.set(compChildOrder[i], i)

  const ranks = new Map<string, number>()
  for (let index = 0; index < instParent.childIds.length; index++) {
    const childId = instParent.childIds[index]
    const node = graph.nodes.get(childId)
    const source = node
      ? getCompatibleInstanceOverride(
          overrides,
          legacyOverrides,
          instanceId,
          node.id,
          'sourceComponentId'
        )
      : undefined
    const mapped = typeof source === 'string' ? source : node?.componentId
    const componentIndex = mapped ? orderMap.get(mapped) : undefined
    ranks.set(childId, componentIndex ?? compChildOrder.length + index)
  }
  instParent.childIds.sort((left, right) => (ranks.get(left) ?? 0) - (ranks.get(right) ?? 0))
}

/** True when syncing `compParentId` into `instParentId` would form a cycle. */
function isCyclicSync(graph: SceneGraph, compParentId: string, instParentId: string): boolean {
  return compParentId === instParentId || graph.isDescendant(instParentId, compParentId)
}

/** Children already linked to a component child by sourceComponentId or componentId. */
function matchLinkedChildren(
  graph: SceneGraph,
  instParent: SceneNode,
  _instParentId: string,
  overrides: InstanceOverrideState,
  legacyOverrides: Readonly<Record<string, unknown>>,
  instanceId: string,
  compChildIdSet: ReadonlySet<string>,
  instChildMap: Map<string, SceneNode>,
  usedInstChildIds: Set<string>
): void {
  for (const childId of instParent.childIds) {
    const child = graph.nodes.get(childId)
    if (!child) continue
    const sourceComponentId = getCompatibleInstanceOverride(
      overrides,
      legacyOverrides,
      instanceId,
      child.id,
      'sourceComponentId'
    )
    const mappedComponentId =
      typeof sourceComponentId === 'string' ? sourceComponentId : child.componentId
    if (mappedComponentId && compChildIdSet.has(mappedComponentId)) {
      instChildMap.set(mappedComponentId, child)
      usedInstChildIds.add(child.id)
    }
  }
}

function copySyncedFields(
  instChild: SceneNode,
  source: SceneNode,
  updates: Partial<SceneNode>,
  protectedField: Parameters<typeof isProtectedSyncField>[2],
  driven: ReturnType<typeof propertyDrivenFields>
): void {
  for (const key of INSTANCE_SYNC_FIELDS) {
    if (key === 'boundVariables') continue
    if (driven.has(key)) continue
    if (isProtectedSyncField(instChild, key, protectedField)) continue

    copyProp(updates, source, key)
  }
}

export function syncChildren(
  graph: SceneGraph,
  compParentId: string,
  instParentId: string,
  overrides: InstanceOverrideState,
  legacyOverrides: Readonly<Record<string, unknown>> = {},
  instanceId: string = instParentId,
  idMap?: Map<string, string>
): void {
  // Guard against cyclic sync: if the instance parent is inside the component's own
  // subtree, syncing would clone the component into itself — a self-referential cycle
  // that causes unbounded recursion and OOM.
  if (isCyclicSync(graph, compParentId, instParentId)) return

  const compParent = graph.nodes.get(compParentId)
  const instParent = graph.nodes.get(instParentId)
  if (!compParent || !instParent) return

  const ownsIdMap = idMap === undefined
  const cloneIdMap = idMap ?? new Map<string, string>()
  const instChildMap = new Map<string, SceneNode>()
  const usedInstChildIds = new Set<string>()
  const compChildIdSet = new Set(compParent.childIds)

  // Pass 1: Direct matching via sourceComponentId or componentId
  matchLinkedChildren(
    graph,
    instParent,
    instParentId,
    overrides,
    legacyOverrides,
    instanceId,
    compChildIdSet,
    instChildMap,
    usedInstChildIds
  )

  // Pass 2: Fallback matching for unmatched children (e.g. from Figma imports)
  matchFallbackChildren(
    graph,
    compParent,
    instParent,
    instParentId,
    overrides,
    instChildMap,
    usedInstChildIds
  )

  // Pass 3: Clone only genuinely missing component children
  for (const compChildId of compParent.childIds) {
    if (!instChildMap.has(compChildId)) {
      const src = graph.nodes.get(compChildId)
      if (!src) continue
      const clone = cloneChildInCoordinates(graph, src, compParent, instParent)
      cloneIdMap.set(src.id, clone.id)
      if (src.childIds.length > 0) {
        cloneChildrenWithMapping(graph, compChildId, clone.id, 'deep', cloneIdMap)
      }
      instChildMap.set(compChildId, clone)
      usedInstChildIds.add(clone.id)
    }
  }

  // Pass 4: Synchronize properties and recurse
  for (const compChildId of compParent.childIds) {
    const compChild = graph.nodes.get(compChildId)
    const instChild = instChildMap.get(compChildId)
    if (!compChild || !instChild) continue

    cloneIdMap.set(compChild.id, instChild.id)
    const protectedField = childBindingProtection(
      graph,
      instChild,
      overrides,
      legacyOverrides,
      instanceId
    )
    const driven = propertyDrivenFields(graph, instChild, compChild)
    const componentScale =
      (compChild.componentScale * instParent.componentScale) / compParent.componentScale
    const source = sourceInTargetCoordinates(compChild, componentScale)
    const updates: Partial<SceneNode> = { componentScale }
    syncBindingFields(instChild, source, updates, protectedField)
    copySyncedFields(instChild, source, updates, protectedField, driven)
    updateSyncedProps(graph, instChild, updates)
    clearAbsentOptionalSyncFields(graph, instChild, source, protectedField)

    if (
      compChild.childIds.length > 0 &&
      !hasProtectedInstanceOverride(
        overrides,
        legacyOverrides,
        instanceId,
        instChild.id,
        'componentId'
      ) &&
      // The component's frame is the authority on which slot this is; instance copies of
      // its bindings are not synced.
      !ownsSlotContent(graph, instChild, slotPropertyId(compChild))
    ) {
      syncChildren(
        graph,
        compChildId,
        instChild.id,
        overrides,
        legacyOverrides,
        instanceId,
        cloneIdMap
      )
    }
  }

  // Pass 5: Sort instance children to match component child order
  sortInstanceChildren(
    graph,
    instParent,
    instanceId,
    compParent.childIds,
    overrides,
    legacyOverrides,
    instanceId
  )
  if (ownsIdMap) graph.remapClonedNodeReferences(cloneIdMap, 'instance')
}
