import * as Y from 'yjs'

import { ensureMotionTimelineIds, type MotionSpec, type SceneNode } from '@open-pencil/scene-graph'

import { docStateApplyLosesLocal, type DocStateConflictKind } from '@/app/collab/conflict'
import {
  clearMotionSpecYMap,
  compactMotionTimelineYMap,
  MOTION_TIMELINES_DOC_KEY,
  MOTION_TIMELINE_CRDT_LIMITS,
  MOTION_TIMELINE_CHECKPOINT_ORIGIN,
  MOTION_TIMELINE_LOCAL_ORIGIN,
  readMotionSpecFromYMap,
  syncMotionSpecToYMap,
  type MotionTimelineConflict
} from '@/app/collab/motion-timeline-yjs'
import type { EditorStore } from '@/app/editor/active-store'

type ConflictHandler = (kind: DocStateConflictKind) => void

type YNodes = Y.Map<Y.Map<unknown>>
type YImages = Y.Map<Uint8Array>
type YMotionTimelines = Y.Map<Y.Map<unknown>>

interface MotionTimelineDocumentCheckpoint {
  invalidTimelinesRemoved: number
  orphanTimelinesRemoved: number
  derivedTimelinesRemoved: number
  overLimitTimelinesRemoved: number
}

interface MotionTimelineCandidate {
  nodeId: string
  graphNode: boolean
}

const MOTION_TIMELINE_DOCUMENT_CONFLICT_ID = '$document'
const INSTANCE_DERIVED_COLLAB_FIELDS = [
  'motion',
  'motionScene',
  'motionDrivers',
  'prototype',
  'transitionKey',
  'generatedEffect'
] as const satisfies readonly (keyof SceneNode)[]
type InstanceDerivedCollabField = (typeof INSTANCE_DERIVED_COLLAB_FIELDS)[number]

type GraphBindingOptions = {
  store: EditorStore
  getYdoc: () => Y.Doc | null
  getYnodes: () => YNodes | null
  getYmotions?: () => YMotionTimelines | null
  getSuppressGraphSync: () => boolean
  setSuppressYjsEvents: (value: boolean) => void
  syncNodeToYjs: (nodeId: string) => void
}

type YjsObserverOptions = {
  store: EditorStore
  ynodes: Y.Map<Y.Map<unknown>>
  yimages: Y.Map<Uint8Array>
  ymotions?: YMotionTimelines
  getSuppressYjsEvents: () => boolean
  setSuppressGraphSync: (value: boolean) => void
  applyYjsToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void
  applyYjsMotionToGraph?: (events: Y.YEvent<Y.Map<unknown>>[]) => void
}

type YjsGraphSyncOptions = {
  getStore: () => EditorStore
  getYdoc: () => Y.Doc | null
  getYnodes: () => YNodes | null
  getYimages: () => YImages | null
  getYmotions?: () => YMotionTimelines | null
  getSuppressYjsEvents?: () => boolean
  setSuppressYjsEvents: (value: boolean) => void
  // Phase 3 §4.5 — reported when applying a remote docState/page-state update
  // would overwrite a concurrent local edit (whole-field LWW, no auto-merge).
  getConflictHandler?: () => ConflictHandler | undefined
  getMotionConflictHandler?: () => ((conflict: MotionTimelineConflict) => void) | undefined
}

function logCollabSyncError(context: string, error: unknown) {
  console.error(`[Collab] ${context}:`, error)
}

// Clone across the graph/Yjs boundary to avoid shared mutable nested data.
export function syncNodePropsToYMap(node: SceneNode, ynode: Y.Map<unknown>) {
  const currentKeys = new Set(Object.keys(node))
  for (const key of ynode.keys()) {
    if (!currentKeys.has(key)) ynode.delete(key)
  }
  for (const [key, value] of Object.entries(node)) {
    ynode.set(key, structuredClone(value))
  }
}

export function yNodeToProps(ynode: Y.Map<unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [key, value] of ynode.entries()) {
    props[key] = structuredClone(value)
  }
  return props
}

export function bindCollabGraphEvents({
  store,
  getYdoc,
  getYnodes,
  getYmotions,
  getSuppressGraphSync,
  setSuppressYjsEvents,
  syncNodeToYjs
}: GraphBindingOptions) {
  function onGraphMutation(nodeId: string) {
    if (!getSuppressGraphSync() && getYdoc() && getYnodes()) {
      syncNodeToYjs(nodeId)
    }
  }

  const unbinds = [
    store.onEditorEvent('node:updated', (id) => onGraphMutation(id)),
    store.onEditorEvent('node:created', (node) => onGraphMutation(node.id)),
    store.onEditorEvent('node:reparented', (nodeId) => onGraphMutation(nodeId)),
    store.onEditorEvent('node:reordered', (nodeId) => onGraphMutation(nodeId)),
    store.onEditorEvent('node:deleted', (id) => {
      const ydoc = getYdoc()
      const ynodes = getYnodes()
      const ymotions = getYmotions?.()
      if (!getSuppressGraphSync() && ydoc && ynodes) {
        setSuppressYjsEvents(true)
        try {
          ydoc.transact(() => {
            ynodes.delete(id)
            ymotions?.delete(id)
          })
        } catch (error) {
          logCollabSyncError('Failed to delete synced node', error)
        } finally {
          setSuppressYjsEvents(false)
        }
      }
    })
  ]
  return () => {
    for (const unbind of unbinds) unbind()
  }
}

export function registerYjsObservers({
  store,
  ynodes,
  yimages,
  ymotions,
  getSuppressYjsEvents,
  setSuppressGraphSync,
  applyYjsToGraph,
  applyYjsMotionToGraph
}: YjsObserverOptions) {
  ynodes.observeDeep((events) => {
    if (getSuppressYjsEvents()) return
    setSuppressGraphSync(true)
    try {
      applyYjsToGraph(events)
      store.requestRender()
    } catch (error) {
      logCollabSyncError('Failed to apply remote graph changes', error)
    } finally {
      setSuppressGraphSync(false)
    }
  })

  const motionTimelines =
    ymotions ??
    (ynodes.doc ? ynodes.doc.getMap<Y.Map<unknown>>(MOTION_TIMELINES_DOC_KEY) : undefined)
  if (motionTimelines && applyYjsMotionToGraph) {
    let applyingMotionEvents = false
    const applyMotionEvents = (events: Y.YEvent<Y.Map<unknown>>[]) => {
      if (getSuppressYjsEvents() || applyingMotionEvents) return
      applyingMotionEvents = true
      setSuppressGraphSync(true)
      try {
        applyYjsMotionToGraph(events)
        store.requestRender()
      } catch (error) {
        logCollabSyncError('Failed to apply remote Motion timeline changes', error)
      } finally {
        setSuppressGraphSync(false)
        applyingMotionEvents = false
      }
    }
    motionTimelines.observeDeep(applyMotionEvents)
    // Existing IndexedDB/room state can predate observer registration in tests and reconnect paths.
    // An empty event batch is the explicit hydrate signal and still runs the safety checkpoint.
    if (motionTimelines.size > 0) applyMotionEvents([])
  }

  yimages.observe((event) => {
    if (getSuppressYjsEvents()) return
    try {
      for (const [key, change] of event.changes.keys) {
        if (change.action === 'add' || change.action === 'update') {
          const data = yimages.get(key)
          if (data) store.graph.images.set(key, new Uint8Array(data))
        } else {
          store.graph.images.delete(key)
        }
      }
      store.requestRender()
    } catch (error) {
      logCollabSyncError('Failed to apply remote image changes', error)
    }
  })
}

export function createYjsGraphSync({
  getStore,
  getYdoc,
  getYnodes,
  getYimages,
  getYmotions,
  getSuppressYjsEvents,
  setSuppressYjsEvents,
  getConflictHandler,
  getMotionConflictHandler
}: YjsGraphSyncOptions) {
  const normalizingMotionNodes = new Set<string>()

  function motionTimelines(): YMotionTimelines | null {
    return getYmotions?.() ?? getYdoc()?.getMap<Y.Map<unknown>>(MOTION_TIMELINES_DOC_KEY) ?? null
  }

  function compareAsciiIds(left: string, right: string): number {
    if (left < right) return -1
    if (left > right) return 1
    return 0
  }

  function hasInstanceOverride(value: unknown, field: InstanceDerivedCollabField): boolean {
    if (value instanceof Y.Map) return value.has(field)
    return value !== null && typeof value === 'object' && Object.hasOwn(value, field)
  }

  function yNodeType(ynode: Y.Map<unknown> | undefined): SceneNode['type'] | undefined {
    const type = ynode?.get('type')
    return typeof type === 'string' ? (type as SceneNode['type']) : undefined
  }

  function ownsIndependentMotionTimeline(
    node: SceneNode | undefined,
    ynode: Y.Map<unknown> | undefined
  ): boolean {
    const type = yNodeType(ynode) ?? node?.type
    if (type !== 'INSTANCE') return true
    if (ynode?.has('overrides')) return hasInstanceOverride(ynode.get('overrides'), 'motion')
    return Boolean(node && Object.hasOwn(node.overrides, 'motion'))
  }

  function compareTimelineCandidates(
    left: MotionTimelineCandidate,
    right: MotionTimelineCandidate
  ): number {
    if (left.graphNode !== right.graphNode) return left.graphNode ? -1 : 1
    return compareAsciiIds(left.nodeId, right.nodeId)
  }

  function insertTimelineCandidate(
    retained: MotionTimelineCandidate[],
    candidate: MotionTimelineCandidate
  ): MotionTimelineCandidate | undefined {
    let index = 0
    while (index < retained.length && compareTimelineCandidates(retained[index], candidate) <= 0) {
      index++
    }
    retained.splice(index, 0, candidate)
    if (retained.length <= MOTION_TIMELINE_CRDT_LIMITS.maxStoredTimelineNodes) return undefined
    return retained.pop()
  }

  function compactMotionTimelineDocument(
    timelines: YMotionTimelines
  ): MotionTimelineDocumentCheckpoint {
    const store = getStore()
    const ynodes = getYnodes()
    const retained: MotionTimelineCandidate[] = []
    const result: MotionTimelineDocumentCheckpoint = {
      invalidTimelinesRemoved: 0,
      orphanTimelinesRemoved: 0,
      derivedTimelinesRemoved: 0,
      overLimitTimelinesRemoved: 0
    }

    for (const [nodeId, timeline] of timelines.entries()) {
      if (!(timeline instanceof Y.Map)) {
        timelines.delete(nodeId)
        result.invalidTimelinesRemoved++
        continue
      }
      const node = store.graph.getNode(nodeId)
      const ynode = ynodes?.get(nodeId)
      const pendingNode = ynode instanceof Y.Map && yNodeType(ynode) !== undefined
      if (!node && !pendingNode) {
        timelines.delete(nodeId)
        result.orphanTimelinesRemoved++
        continue
      }
      if (!ownsIndependentMotionTimeline(node, ynode)) {
        timelines.delete(nodeId)
        result.derivedTimelinesRemoved++
        continue
      }
      const evicted = insertTimelineCandidate(retained, {
        nodeId,
        graphNode: node !== undefined
      })
      if (!evicted) continue
      timelines.delete(evicted.nodeId)
      result.overLimitTimelinesRemoved++
    }
    return result
  }

  function reportMotionDocumentCheckpoint(result: MotionTimelineDocumentCheckpoint): void {
    const removed =
      result.invalidTimelinesRemoved +
      result.orphanTimelinesRemoved +
      result.derivedTimelinesRemoved +
      result.overLimitTimelinesRemoved
    if (removed === 0) return
    getMotionConflictHandler?.()?.({
      nodeId: MOTION_TIMELINE_DOCUMENT_CONFLICT_ID,
      code: 'resource-limit',
      message:
        `Quarantined ${removed} document Motion timelines ` +
        `(${result.overLimitTimelinesRemoved} over limit, ` +
        `${result.orphanTimelinesRemoved} orphan, ` +
        `${result.derivedTimelinesRemoved} derived instance, ` +
        `${result.invalidTimelinesRemoved} invalid)`
    })
  }

  function checkpointMotionTimelineDocument(): MotionTimelineDocumentCheckpoint | undefined {
    const timelines = motionTimelines()
    if (!timelines) return undefined
    const ydoc = getYdoc()
    const wasSuppressed = getSuppressYjsEvents?.() ?? false
    if (!wasSuppressed) setSuppressYjsEvents(true)
    let result: MotionTimelineDocumentCheckpoint | undefined
    try {
      if (ydoc) {
        ydoc.transact(() => {
          result = compactMotionTimelineDocument(timelines)
        }, MOTION_TIMELINE_CHECKPOINT_ORIGIN)
      } else {
        result = compactMotionTimelineDocument(timelines)
      }
    } finally {
      if (!wasSuppressed) setSuppressYjsEvents(false)
    }
    if (result) reportMotionDocumentCheckpoint(result)
    return result
  }

  function reportMotionCheckpoint(
    nodeId: string,
    compacted: ReturnType<typeof compactMotionTimelineYMap>
  ): void {
    const handler = getMotionConflictHandler?.()
    if (!handler) return
    const resourceQuarantined =
      compacted.liveTracksRemoved + compacted.liveKeyframesRemoved + compacted.resourceFieldsRemoved
    if (resourceQuarantined > 0) {
      handler({
        nodeId,
        code: 'resource-limit',
        message: `Quarantined ${resourceQuarantined} over-limit Motion timeline records or fields`
      })
    }
    const invalidQuarantined = compacted.invalidRecordsRemoved + compacted.schemaFieldsRemoved
    if (invalidQuarantined > 0) {
      handler({
        nodeId,
        code: 'invalid-timeline',
        message: `Quarantined ${invalidQuarantined} invalid Motion timeline records or fields`
      })
    }
    const tombstonesRemoved = Math.max(
      0,
      compacted.tracksRemoved +
        compacted.keyframesRemoved -
        compacted.liveTracksRemoved -
        compacted.liveKeyframesRemoved -
        compacted.invalidRecordsRemoved
    )
    if (tombstonesRemoved > 0) {
      handler({
        nodeId,
        code: 'tombstones-compacted',
        message: `Compacted ${tombstonesRemoved} Motion timeline tombstones`
      })
    }
  }

  function checkpointMotionTimeline(nodeId: string, timeline: Y.Map<unknown>): void {
    const ydoc = getYdoc()
    const wasSuppressed = getSuppressYjsEvents?.() ?? false
    if (!wasSuppressed) setSuppressYjsEvents(true)
    let compacted: ReturnType<typeof compactMotionTimelineYMap> | undefined
    try {
      if (ydoc) {
        ydoc.transact(() => {
          compacted = compactMotionTimelineYMap(timeline)
        }, MOTION_TIMELINE_CHECKPOINT_ORIGIN)
      } else {
        compacted = compactMotionTimelineYMap(timeline)
      }
    } finally {
      if (!wasSuppressed) setSuppressYjsEvents(false)
    }
    if (compacted) reportMotionCheckpoint(nodeId, compacted)
  }

  function normalizedV3Motion(node: SceneNode): MotionSpec | undefined {
    if (node.motion?.version !== 3) return node.motion
    const normalized = ensureMotionTimelineIds(node.motion)
    if (JSON.stringify(normalized) === JSON.stringify(node.motion)) return normalized
    if (!normalizingMotionNodes.has(node.id)) {
      normalizingMotionNodes.add(node.id)
      try {
        const changes: Partial<SceneNode> = { motion: normalized }
        if (node.type === 'INSTANCE' && Object.hasOwn(node.overrides, 'motion')) {
          changes.overrides = { ...node.overrides, motion: structuredClone(normalized) }
        }
        getStore().graph.updateNode(node.id, changes)
      } finally {
        normalizingMotionNodes.delete(node.id)
      }
    }
    return normalized
  }

  function syncNodeProperties(
    node: SceneNode,
    ynode: Y.Map<unknown>,
    motion: MotionSpec | undefined
  ) {
    const omitted = new Set<keyof SceneNode>()
    if (node.type === 'INSTANCE') {
      for (const field of INSTANCE_DERIVED_COLLAB_FIELDS) {
        if (!Object.hasOwn(node.overrides, field)) omitted.add(field)
      }
    }
    if (motion?.version === 3) omitted.add('motion')
    const collaborativeProps = Object.fromEntries(
      Object.entries(node).filter(([key]) => !omitted.has(key as keyof SceneNode))
    )
    syncNodePropsToYMap(collaborativeProps as SceneNode, ynode)
  }

  function syncMotionTimeline(node: SceneNode, motion: MotionSpec | undefined): void {
    const timelines = motionTimelines()
    if (!timelines) return
    const current = timelines.get(node.id)
    if (node.type === 'INSTANCE' && !Object.hasOwn(node.overrides, 'motion')) {
      if (current !== undefined) timelines.delete(node.id)
      return
    }
    if (motion?.version === 3) {
      const target = current instanceof Y.Map ? current : new Y.Map<unknown>()
      if (target !== current) timelines.set(node.id, target)
      syncMotionSpecToYMap(motion, target)
      const compacted = compactMotionTimelineYMap(target)
      reportMotionCheckpoint(node.id, compacted)
    } else if (current instanceof Y.Map) {
      clearMotionSpecYMap(current)
    }
  }

  function syncNodeToYjs(nodeId: string) {
    if (normalizingMotionNodes.has(nodeId)) return
    const store = getStore()
    const ydoc = getYdoc()
    const ynodes = getYnodes()
    if (!ydoc || !ynodes) return
    const node = store.graph.getNode(nodeId)
    if (!node) return
    const motion = normalizedV3Motion(node)

    const localYimages = getYimages()
    setSuppressYjsEvents(true)
    try {
      ydoc.transact(() => {
        let ynode = ynodes.get(nodeId)
        if (!ynode) {
          ynode = new Y.Map()
          ynodes.set(nodeId, ynode)
        }
        syncNodeProperties(node, ynode, motion)
        syncMotionTimeline(node, motion)

        if (localYimages) {
          for (const fill of node.fills) {
            if (fill.imageHash && !localYimages.has(fill.imageHash)) {
              const data = store.graph.images.get(fill.imageHash)
              if (data) localYimages.set(fill.imageHash, data)
            }
          }
        }
      }, MOTION_TIMELINE_LOCAL_ORIGIN)
    } catch (error) {
      logCollabSyncError(`Failed to sync node ${nodeId}`, error)
    } finally {
      setSuppressYjsEvents(false)
    }
    checkpointMotionTimelineDocument()
  }

  function syncAllNodesToYjs() {
    const store = getStore()
    const ydoc = getYdoc()
    const ynodes = getYnodes()
    if (!ydoc || !ynodes) return
    const localYimages = getYimages()
    setSuppressYjsEvents(true)
    try {
      ydoc.transact(() => {
        for (const node of store.graph.getAllNodes()) {
          const motion = normalizedV3Motion(node)
          let ynode = ynodes.get(node.id)
          if (!ynode) {
            ynode = new Y.Map()
            ynodes.set(node.id, ynode)
          }
          syncNodeProperties(node, ynode, motion)
          syncMotionTimeline(node, motion)
        }
      }, MOTION_TIMELINE_LOCAL_ORIGIN)
      if (localYimages) {
        ydoc.transact(() => {
          for (const [hash, data] of store.graph.images) {
            if (!localYimages.has(hash)) {
              localYimages.set(hash, data)
            }
          }
        })
      }
    } catch (error) {
      logCollabSyncError('Failed to sync document', error)
    } finally {
      setSuppressYjsEvents(false)
    }
    checkpointMotionTimelineDocument()
  }

  function applyYjsToGraph(events: Y.YEvent<Y.Map<unknown>>[]) {
    const store = getStore()
    const ynodes = getYnodes()
    if (!ynodes) return
    const affectedMotionNodes = new Set<string>()
    for (const event of events) {
      if (event.target === ynodes) {
        for (const [key, change] of event.changes.keys) {
          if (change.action === 'add') {
            const ynode = ynodes.get(key)
            if (ynode) {
              applyYnodeToGraph(key, ynode)
              affectedMotionNodes.add(key)
            }
          } else if (change.action === 'delete') {
            store.graph.deleteNode(key)
          }
        }
      } else if (event.target.parent === ynodes) {
        const nodeId = findNodeIdForYMap(event.target)
        if (nodeId) {
          const ynode = ynodes.get(nodeId)
          const deletedFields = [...event.changes.keys]
            .filter(([, change]) => change.action === 'delete')
            .map(([key]) => key as keyof SceneNode)
          if (ynode) {
            applyYnodeToGraph(nodeId, ynode, deletedFields)
            affectedMotionNodes.add(nodeId)
          }
        }
      }
    }
    const timelines = motionTimelines()
    if (!timelines || timelines.size === 0) return
    checkpointMotionTimelineDocument()
    for (const nodeId of [...affectedMotionNodes].sort()) {
      if (timelines.has(nodeId) && store.graph.getNode(nodeId)) {
        applyMotionSnapshot(nodeId)
      }
    }
  }

  function parentOf(value: unknown): unknown {
    return value && typeof value === 'object' && 'parent' in value
      ? (value as { parent: unknown }).parent
      : null
  }

  function findMotionOwnerId(target: unknown): string | null {
    const timelines = motionTimelines()
    if (!timelines) return null
    let current: unknown = target
    while (parentOf(current) && parentOf(current) !== timelines) current = parentOf(current)
    if (!current || parentOf(current) !== timelines) return null
    for (const [nodeId, value] of timelines.entries()) {
      if (value === current) return nodeId
    }
    return null
  }

  function hasOpaqueLegacyMotion(nodeId: string): boolean {
    const opaqueMotion = getYnodes()?.get(nodeId)?.get('motion')
    return Boolean(
      opaqueMotion &&
      typeof opaqueMotion === 'object' &&
      'version' in opaqueMotion &&
      (opaqueMotion as { version?: unknown }).version !== 3
    )
  }

  function applyDecodedMotion(node: SceneNode, motion: MotionSpec | undefined): void {
    const store = getStore()
    if (!motion) {
      if (Object.hasOwn(node, 'motion')) store.graph.clearNodeFields(node.id, ['motion'])
      if (node.type === 'INSTANCE' && Object.hasOwn(node.overrides, 'motion')) {
        store.graph.updateNode(node.id, { overrides: { ...node.overrides, motion: null } })
      }
      return
    }
    const changes: Partial<SceneNode> = { motion }
    if (node.type === 'INSTANCE' && Object.hasOwn(node.overrides, 'motion')) {
      changes.overrides = { ...node.overrides, motion: structuredClone(motion) }
    }
    store.graph.updateNode(node.id, changes)
  }

  function applyMotionSnapshot(nodeId: string): void {
    const timeline = motionTimelines()?.get(nodeId)
    if (!(timeline instanceof Y.Map)) return
    const store = getStore()
    const node = store.graph.getNode(nodeId)
    if (!node) return
    if (node.type === 'INSTANCE' && !Object.hasOwn(node.overrides, 'motion')) return
    checkpointMotionTimeline(nodeId, timeline)
    if (hasOpaqueLegacyMotion(nodeId)) return
    const result = readMotionSpecFromYMap(nodeId, timeline)
    for (const issue of result.conflicts) getMotionConflictHandler?.()?.(issue)
    applyDecodedMotion(node, result.motion)
  }

  function applyYjsMotionToGraph(events: Y.YEvent<Y.Map<unknown>>[]): void {
    const timelines = motionTimelines()
    if (!timelines) return
    checkpointMotionTimelineDocument()
    const affected = new Set<string>()
    if (events.length === 0) {
      for (const nodeId of timelines.keys()) {
        if (getStore().graph.getNode(nodeId)) affected.add(nodeId)
      }
    }
    for (const event of events) {
      if (event.target === timelines) {
        for (const [nodeId] of event.changes.keys) {
          if (timelines.has(nodeId) && getStore().graph.getNode(nodeId)) affected.add(nodeId)
        }
      } else {
        const nodeId = findMotionOwnerId(event.target)
        if (nodeId) affected.add(nodeId)
      }
    }
    for (const nodeId of [...affected].sort()) {
      if (timelines.has(nodeId) && getStore().graph.getNode(nodeId)) {
        applyMotionSnapshot(nodeId)
      }
    }
  }

  function findNodeIdForYMap(ymap: Y.Map<unknown>): string | null {
    const ynodes = getYnodes()
    if (!ynodes) return null
    for (const [key, value] of ynodes.entries()) {
      if (value === ymap) return key
    }
    return null
  }

  function reportDocStateConflicts(existing: SceneNode, props: Record<string, unknown>) {
    const handler = getConflictHandler?.()
    if (!handler) return
    // §4.5 — these two array collections are whole-field LWW; if applying the
    // remote value would drop a concurrent local entry, surface it (no auto-merge).
    if ('state' in props && docStateApplyLosesLocal(existing.state, props.state)) {
      handler('state')
    }
    if (
      'lowcodeDocumentState' in props &&
      docStateApplyLosesLocal(existing.lowcodeDocumentState, props.lowcodeDocumentState)
    ) {
      handler('docState')
    }
  }

  function derivedInstanceFields(
    existing: SceneNode | undefined,
    props: Record<string, unknown>
  ): Set<InstanceDerivedCollabField> {
    const type = typeof props.type === 'string' ? props.type : existing?.type
    if (type !== 'INSTANCE') return new Set()
    const overrides = Object.hasOwn(props, 'overrides') ? props.overrides : existing?.overrides
    return new Set(
      INSTANCE_DERIVED_COLLAB_FIELDS.filter((field) => !hasInstanceOverride(overrides, field))
    )
  }

  function applyYnodeToGraph(
    nodeId: string,
    ynode: Y.Map<unknown>,
    deletedFields: readonly (keyof SceneNode)[] = []
  ) {
    const store = getStore()
    const existing = store.graph.getNode(nodeId)
    const incomingProps = yNodeToProps(ynode)
    const derivedFields = derivedInstanceFields(existing, incomingProps)
    const props = Object.fromEntries(
      Object.entries(incomingProps).filter(
        ([key]) => !derivedFields.has(key as InstanceDerivedCollabField)
      )
    )
    const parentId = typeof props.parentId === 'string' ? props.parentId : null

    if (existing) {
      reportDocStateConflicts(existing, props)
      const fieldsToClear = deletedFields.filter(
        (key) =>
          !derivedFields.has(key as InstanceDerivedCollabField) &&
          Object.hasOwn(existing, key) &&
          !Object.hasOwn(props, key)
      )
      if (fieldsToClear.length > 0) store.graph.clearNodeFields(nodeId, fieldsToClear)
      store.graph.updateNode(nodeId, props as Partial<SceneNode>)
      if (parentId === null) store.graph.rootId = nodeId
      ensureCurrentPageExists(store)
      return
    }

    const type = props.type as SceneNode['type'] | undefined
    if (!type) return
    // Parent childIds may arrive before or after the child node.
    store.graph.createNodeWithId(nodeId, type, parentId, props as Partial<SceneNode>)
    if (parentId === null) store.graph.rootId = nodeId
    ensureCurrentPageExists(store)
  }

  function ensureCurrentPageExists(store: EditorStore) {
    const pages = store.graph.getPages()
    if (pages.some((page) => page.id === store.state.currentPageId)) return
    if (pages.length === 0) return
    void store.switchPage(pages[0].id)
  }

  return { syncNodeToYjs, syncAllNodesToYjs, applyYjsToGraph, applyYjsMotionToGraph }
}
