import * as Y from 'yjs'

import { ensureMotionTimelineIds, type MotionSpec, type SceneNode } from '@open-pencil/scene-graph'

import { docStateApplyLosesLocal, type DocStateConflictKind } from '@/app/collab/conflict'
import {
  clearMotionSpecYMap,
  compactMotionTimelineYMap,
  MOTION_TIMELINES_DOC_KEY,
  MOTION_TIMELINE_CRDT_LIMITS,
  MOTION_TIMELINE_CHECKPOINT_ORIGIN,
  readMotionSpecFromYMap,
  syncMotionSpecToYMap,
  type MotionTimelineConflict
} from '@/app/collab/motion-timeline-yjs'
import {
  decodeNodeFromYjs,
  syncEncodedNodeToYMap,
  type DecodedYjsNodeProps
} from '@/app/collab/node-codec'
import type { EditorStore } from '@/app/editor/active-store'

type ConflictHandler = (kind: DocStateConflictKind) => void

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

export function syncNodePropsToYMap(node: SceneNode, ynode: Y.Map<unknown>) {
  const currentKeys = new Set(Object.keys(node))
  for (const key of ['parents', 'orderKey', 'page', 'parentId', 'childIds']) currentKeys.add(key)
  for (const key of ynode.keys()) {
    if (!currentKeys.has(key) && !key.startsWith('$')) ynode.delete(key)
  }
  syncEncodedNodeToYMap(node, ynode)
}

// Compatibility export retained for the fork's focused collaboration tests and downstream callers.
// oxlint-disable-next-line open-pencil/no-useless-pass-through-wrappers
export function yNodeToProps(ynode: Y.Map<unknown>): DecodedYjsNodeProps {
  return decodeNodeFromYjs(ynode)
}

interface MotionSyncOptions {
  getStore: () => EditorStore
  getYdoc: () => Y.Doc | null
  getYnodes: () => Y.Map<Y.Map<unknown>> | null
  getYmotions?: () => YMotionTimelines | null
  getSuppressYjsEvents?: () => boolean
  setSuppressYjsEvents: (value: boolean) => void
  getConflictHandler?: () => ConflictHandler | undefined
  getMotionConflictHandler?: () => ((conflict: MotionTimelineConflict) => void) | undefined
}

export function createMotionGraphSync({
  getStore,
  getYdoc,
  getYnodes,
  getYmotions,
  getSuppressYjsEvents,
  setSuppressYjsEvents,
  getConflictHandler,
  getMotionConflictHandler
}: MotionSyncOptions) {
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

  return {
    normalizedV3Motion,
    syncNodeProperties,
    syncMotionTimeline,
    applyYjsMotionToGraph,
    applyMotionSnapshot,
    derivedInstanceFields,
    reportDocStateConflicts,
    checkpointMotionTimelineDocument
  }
}
