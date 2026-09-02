import type { SceneGraph, SceneNode } from './'
import { cloneNodeProps, copyEffects, copyFills, copyStrokes, copyStyleRuns } from './copy'
import type { NodeCloneMode } from './copy'
import {
  createInstanceOverrideState,
  getInstanceOverride,
  hasInstanceOverride as hasNodeInstanceOverride,
  setInstanceOverride,
  type InstanceOverrideState
} from './instance-overrides'
import {
  cloneGeneratedEffectSpec,
  cloneMotionDriverSpec,
  cloneMotionSceneSpec,
  cloneMotionSpec,
  clonePrototypeSpec,
  parseMotionTransitionKey
} from './motion'

export type { NodeCloneMode } from './copy'

export const INSTANCE_SYNC_TEXT_PROPS = [
  'name',
  'text',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'textDirection'
] as const

export const INSTANCE_SYNC_PROPS: (keyof SceneNode)[] = [
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'fills',
  'strokes',
  'effects',
  'opacity',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
  'independentCorners',
  'layoutMode',
  'layoutDirection',
  'layoutWrap',
  'primaryAxisAlign',
  'counterAxisAlign',
  'primaryAxisSizing',
  'counterAxisSizing',
  'itemSpacing',
  'counterAxisSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridColumnGap',
  'gridRowGap',
  'gridPosition',
  'clipsContent',
  'independentStrokeWeights',
  'borderTopWeight',
  'borderRightWeight',
  'borderBottomWeight',
  'borderLeftWeight',
  'boundVariables',
  'variableModes',
  'motion',
  'motionScene',
  'motionDrivers',
  'prototype',
  'transitionKey',
  'generatedEffect'
]

const OPTIONAL_INSTANCE_SYNC_PROPS = [
  'motion',
  'motionScene',
  'motionDrivers',
  'prototype',
  'transitionKey',
  'generatedEffect'
] as const satisfies readonly (keyof SceneNode)[]

export const INSTANCE_SYNC_FIELDS = [...INSTANCE_SYNC_PROPS, ...INSTANCE_SYNC_TEXT_PROPS] as const

function legacyOverrideKey(instanceId: string, nodeId: string, field: string): string {
  return nodeId === instanceId ? field : `${nodeId}:${field}`
}

function hasProtectedInstanceOverride(
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

function getCompatibleInstanceOverride(
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

function setSceneProp<K extends keyof SceneNode>(
  target: Partial<SceneNode>,
  key: K,
  value: SceneNode[K]
): void {
  target[key] = value
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

function copyProp(
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

function cloneChildrenWithMapping(
  graph: SceneGraph,
  sourceParentId: string,
  destParentId: string,
  mode: NodeCloneMode = 'deep',
  idMap?: Map<string, string>
): void {
  const ownsIdMap = idMap === undefined
  const cloneIdMap = idMap ?? new Map<string, string>()
  const sourceParent = graph.nodes.get(sourceParentId)
  if (!sourceParent) return

  for (const childId of sourceParent.childIds) {
    const src = graph.nodes.get(childId)
    if (!src) continue

    const clone = graph.createNode(src.type, destParentId, cloneNodeProps(src, childId, mode))
    cloneIdMap.set(src.id, clone.id)

    if (src.childIds.length > 0) {
      cloneChildrenWithMapping(graph, childId, clone.id, mode, cloneIdMap)
    }
  }

  if (ownsIdMap) graph.remapClonedNodeReferences(cloneIdMap)
}

function syncChildren(
  graph: SceneGraph,
  compParentId: string,
  instParentId: string,
  instanceId: string,
  overrides: InstanceOverrideState,
  legacyOverrides: Readonly<Record<string, unknown>>,
  idMap: Map<string, string>
): void {
  const compParent = graph.nodes.get(compParentId)
  const instParent = graph.nodes.get(instParentId)
  if (!compParent || !instParent) return

  idMap.set(compParentId, instParentId)

  const instChildMap = new Map<string, SceneNode>()
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
    if (mappedComponentId) {
      instChildMap.set(mappedComponentId, child)
      idMap.set(mappedComponentId, child.id)
    }
  }

  for (const compChildId of compParent.childIds) {
    if (!instChildMap.has(compChildId)) {
      const src = graph.nodes.get(compChildId)
      if (!src) continue
      const clone = graph.createNode(src.type, instParentId, cloneNodeProps(src, compChildId))
      idMap.set(src.id, clone.id)
      if (src.childIds.length > 0) {
        cloneChildrenWithMapping(graph, compChildId, clone.id, 'deep', idMap)
      }
      instChildMap.set(compChildId, clone)
    }
  }

  for (const compChildId of compParent.childIds) {
    const compChild = graph.nodes.get(compChildId)
    const instChild = instChildMap.get(compChildId)
    if (!compChild || !instChild) continue

    for (const key of INSTANCE_SYNC_FIELDS) {
      if (hasProtectedInstanceOverride(overrides, legacyOverrides, instanceId, instChild.id, key)) {
        continue
      }

      copyProp(instChild, compChild, key)
    }

    if (
      compChild.childIds.length > 0 &&
      !hasProtectedInstanceOverride(
        overrides,
        legacyOverrides,
        instanceId,
        instChild.id,
        'componentId'
      )
    ) {
      syncChildren(graph, compChildId, instChild.id, instanceId, overrides, legacyOverrides, idMap)
    }
  }

  const compChildOrder = compParent.childIds
  instParent.childIds.sort((a, b) => {
    const nodeA = graph.nodes.get(a)
    const nodeB = graph.nodes.get(b)
    const sourceA = nodeA
      ? getCompatibleInstanceOverride(
          overrides,
          legacyOverrides,
          instanceId,
          nodeA.id,
          'sourceComponentId'
        )
      : undefined
    const sourceB = nodeB
      ? getCompatibleInstanceOverride(
          overrides,
          legacyOverrides,
          instanceId,
          nodeB.id,
          'sourceComponentId'
        )
      : undefined

    const mappedA = typeof sourceA === 'string' ? sourceA : nodeA?.componentId
    const mappedB = typeof sourceB === 'string' ? sourceB : nodeB?.componentId
    const idxA = mappedA ? compChildOrder.indexOf(mappedA) : -1
    const idxB = mappedB ? compChildOrder.indexOf(mappedB) : -1
    return idxA - idxB
  })
}

export function copyInstanceComponentProps(component: SceneNode): Partial<SceneNode> {
  const props: Partial<SceneNode> = {}
  for (const key of INSTANCE_SYNC_PROPS) copyProp(props, component, key)
  return props
}

export function createInstance(
  graph: SceneGraph,
  componentId: string,
  parentId: string,
  overrides: Partial<SceneNode> = {}
): SceneNode | null {
  const component = graph.nodes.get(componentId)
  if (component?.type !== 'COMPONENT') return null

  const props: Partial<SceneNode> = {
    ...copyInstanceComponentProps(component),
    name: component.name,
    componentId
  }

  const instance = graph.createNode('INSTANCE', parentId, { ...props, ...overrides })

  const cloneIdMap = new Map([[component.id, instance.id]])
  cloneChildrenWithMapping(graph, component.id, instance.id, 'deep', cloneIdMap)
  graph.remapClonedNodeReferences(cloneIdMap)

  return instance
}

export function populateInstanceChildren(
  graph: SceneGraph,
  instanceId: string,
  componentId: string,
  mode: NodeCloneMode = 'deep'
): void {
  const instance = graph.nodes.get(instanceId)
  const component = graph.nodes.get(componentId)
  if (!instance || !component || instance.type !== 'INSTANCE') return
  const cloneIdMap = new Map([[componentId, instanceId]])
  cloneChildrenWithMapping(graph, componentId, instanceId, mode, cloneIdMap)
  graph.remapClonedNodeReferences(cloneIdMap)
}

export function swapInstanceComponent(
  graph: SceneGraph,
  instanceId: string,
  componentId: string
): void {
  const instance = graph.nodes.get(instanceId)
  const component = graph.nodes.get(componentId)
  if (!instance || component?.type !== 'COMPONENT' || instance.type !== 'INSTANCE') return

  const previousComponent = instance.componentId ? graph.nodes.get(instance.componentId) : undefined
  const updates: Partial<SceneNode> = { componentId }
  const fieldsToClear = OPTIONAL_INSTANCE_SYNC_PROPS.filter(
    (key) =>
      instance[key] !== undefined &&
      component[key] === undefined &&
      !hasProtectedInstanceOverride(
        instance.instanceOverrides,
        instance.overrides,
        instance.id,
        instance.id,
        key
      )
  )
  for (const key of INSTANCE_SYNC_PROPS) {
    if (
      hasProtectedInstanceOverride(
        instance.instanceOverrides,
        instance.overrides,
        instance.id,
        instance.id,
        key
      )
    ) {
      continue
    }
    copyProp(updates, component, key)
  }

  if (!previousComponent || instance.name === previousComponent.name) updates.name = component.name

  const childIds = Array.from(instance.childIds)
  for (const childId of childIds) graph.deleteNode(childId)
  graph.updateNode(instanceId, updates)
  if (fieldsToClear.length > 0) graph.clearNodeFields(instanceId, fieldsToClear)
  const cloneIdMap = new Map([[componentId, instanceId]])
  cloneChildrenWithMapping(graph, componentId, instanceId, 'deep', cloneIdMap)
  graph.remapClonedNodeReferences(cloneIdMap)
}

export function syncInstances(graph: SceneGraph, componentId: string): void {
  const component = graph.nodes.get(componentId)
  if (component?.type !== 'COMPONENT') return

  for (const instance of getInstances(graph, componentId)) {
    for (const key of INSTANCE_SYNC_PROPS) {
      if (
        hasProtectedInstanceOverride(
          instance.instanceOverrides,
          instance.overrides,
          instance.id,
          instance.id,
          key
        )
      )
        continue
      copyProp(instance, component, key)
    }

    const cloneIdMap = new Map([[component.id, instance.id]])
    syncChildren(
      graph,
      component.id,
      instance.id,
      instance.id,
      instance.instanceOverrides,
      instance.overrides,
      cloneIdMap
    )
    graph.remapClonedNodeReferences(cloneIdMap)
  }
}

export function detachInstance(graph: SceneGraph, instanceId: string): void {
  const node = graph.nodes.get(instanceId)
  if (node?.type !== 'INSTANCE') return
  graph.updateNode(instanceId, {
    type: 'FRAME',
    componentId: null,
    instanceOverrides: createInstanceOverrideState(),
    overrides: {}
  })
}

export function getMainComponent(graph: SceneGraph, instanceId: string): SceneNode | undefined {
  const node = graph.nodes.get(instanceId)
  if (!node?.componentId) return undefined
  return graph.nodes.get(node.componentId)
}

export function getInstances(graph: SceneGraph, componentId: string): SceneNode[] {
  const ids = graph.instanceIndex.get(componentId)
  if (!ids) return []
  const instances: SceneNode[] = []
  for (const id of ids) {
    const node = graph.nodes.get(id)
    if (node) instances.push(node)
  }
  return instances
}

/** Nearest INSTANCE at or above `nodeId` — self, parent, grandparent, etc. */
export function findInstanceAncestor(graph: SceneGraph, nodeId: string): SceneNode | undefined {
  let current = graph.nodes.get(nodeId)
  while (current) {
    if (current.type === 'INSTANCE') return current
    current = current.parentId ? graph.nodes.get(current.parentId) : undefined
  }
  return undefined
}

/**
 * True when a node field is protected from instance synchronization.
 */
export function hasInstanceOverride(graph: SceneGraph, nodeId: string, field: string): boolean {
  const instance = findInstanceAncestor(graph, nodeId)
  if (!instance) return false
  return hasProtectedInstanceOverride(
    instance.instanceOverrides,
    instance.overrides,
    instance.id,
    nodeId,
    field
  )
}

/*
 * syncInstances) won't clobber them, and — if `nodeId` sits inside an INSTANCE —
 * so the .fig exporter knows to write the diff out as a symbol override. A no-op
 * for fields outside INSTANCE_SYNC_PROPS or nodes with no INSTANCE ancestor.
 */
export function recordInstanceOverrideValue(
  graph: SceneGraph,
  nodeId: string,
  field: string,
  value: unknown
): void {
  const instance = findInstanceAncestor(graph, nodeId)
  if (!instance) return
  setInstanceOverride(instance.instanceOverrides, instance.id, nodeId, field, value)
  graph.updateNode(instance.id, { instanceOverrides: instance.instanceOverrides })
}
export function recordInstanceOverride(
  graph: SceneGraph,
  nodeId: string,
  fields: Iterable<string>
): void {
  const instance = findInstanceAncestor(graph, nodeId)
  if (!instance) return

  const relevant = [...fields].filter((field) =>
    (INSTANCE_SYNC_FIELDS as readonly string[]).includes(field)
  )

  if (relevant.length === 0) return

  for (const field of relevant)
    setInstanceOverride(instance.instanceOverrides, instance.id, nodeId, field)
  graph.updateNode(instance.id, { instanceOverrides: instance.instanceOverrides })
}
