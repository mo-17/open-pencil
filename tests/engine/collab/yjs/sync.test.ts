import { describe, test, expect } from 'bun:test'

import { create as createPRNG } from 'lib0/prng'
import * as Y from 'yjs'
import { TestConnector, type TestYInstance } from 'yjs/testHelper'

import {
  cloneMotionSpec,
  createMotionPreset,
  ensureMotionTimelineIds,
  SceneGraph,
  type Fill,
  type GeometryPath,
  type MotionDriverSpecV1,
  type MotionSceneSpec,
  type SceneNode,
  type MotionSpec,
  type PrototypeSpecV1
} from '@open-pencil/scene-graph'
import { nodeVisualBounds } from '@open-pencil/scene-graph/geometry'
import { createDefaultSourceMetadata } from '@open-pencil/scene-graph/node-defaults'

import {
  MOTION_TIMELINE_CRDT_LIMITS,
  syncMotionSpecToYMap,
  type MotionTimelineConflict
} from '@/app/collab/motion-timeline-yjs'
import {
  createYjsGraphSync,
  registerYjsObservers,
  syncNodePropsToYMap,
  yNodeToProps
} from '@/app/collab/yjs-sync'
import { createEditorStore } from '@/app/editor/session'

import { expectDefined, getNodeOrThrow } from '#tests/helpers/assert'
import { generatedEffect } from '#tests/helpers/generated-effect'
import { connectYDocs } from '#tests/helpers/yjs'

// Test copy of the private apply path.
function applyYnodeToGraph(peer: SceneGraph, nodeId: string, ynode: Y.Map<unknown>) {
  const props = yNodeToProps(ynode)
  if (peer.getNode(nodeId)) {
    peer.updateNode(nodeId, props as Partial<SceneNode>)
    return
  }
  const type = props.type as SceneNode['type'] | undefined
  if (!type) return
  const parentId = typeof props.parentId === 'string' ? props.parentId : null
  peer.createNodeWithId(nodeId, type, parentId, props as Partial<SceneNode>)
  if (parentId === null) peer.rootId = nodeId
}

function seedHostIntoYjs(host: SceneGraph): Y.Map<Y.Map<unknown>> {
  const doc = new Y.Doc()
  const ynodes = doc.getMap<Y.Map<unknown>>('nodes')
  doc.transact(() => {
    for (const node of host.getAllNodes()) {
      const ynode = new Y.Map<unknown>()
      ynodes.set(node.id, ynode)
      syncNodePropsToYMap(node, ynode)
    }
  })
  return ynodes
}

function firstPage(graph: SceneGraph): SceneNode {
  return expectDefined(graph.getPages()[0], 'first page')
}

function v3Motion(id: string, distance: number): MotionSpec {
  return ensureMotionTimelineIds({
    version: 3,
    tracks: [
      {
        id,
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 0 },
          { offset: 1, x: distance }
        ],
        timing: { durationMs: 300 }
      }
    ]
  })
}

function motionScene(targetNodeId: string, trackId: string): MotionSceneSpec {
  return {
    version: 1,
    id: 'collab-scene',
    sequences: [
      {
        id: 'collab-sequence',
        trigger: 'manual',
        cues: [{ id: 'collab-cue', targetNodeId, trackId, startMs: 0 }]
      }
    ]
  }
}

function motionDrivers(nodeId: string, trackId: string): MotionDriverSpecV1 {
  return {
    version: 1,
    drivers: [
      {
        id: 'collab-driver',
        source: { kind: 'scroll', sourceNodeId: nodeId, axis: 'y', metric: 'progress' },
        target: { targetNodeId: nodeId, trackId },
        mapping: { inputMin: 0, inputMax: 1 }
      }
    ]
  }
}

function prototype(targetNodeId: string): PrototypeSpecV1 {
  return {
    version: 1,
    connections: [
      {
        id: 'collab-prototype',
        trigger: { kind: 'click' },
        action: { kind: 'navigate', targetNodeId },
        transition: { kind: 'instant' }
      }
    ]
  }
}

function addStoredTimeline(
  timelines: Y.Map<Y.Map<unknown>>,
  nodeId: string,
  motion: MotionSpec = v3Motion('bounded', 8)
): void {
  const value = new Y.Map<unknown>()
  timelines.set(nodeId, value)
  syncMotionSpecToYMap(motion, value)
}

type SyncedStores = ReturnType<typeof createSyncedStores>

type SyncedStoreOptions = {
  hostDoc?: Y.Doc
  peerDoc?: Y.Doc
  connectImmediately?: boolean
}

function createSyncedStores(options: SyncedStoreOptions = {}) {
  const hostStore = createEditorStore(new SceneGraph())
  const peerStore = createEditorStore(new SceneGraph())
  const hostDoc = options.hostDoc ?? new Y.Doc()
  const peerDoc = options.peerDoc ?? new Y.Doc()
  const hostNodes = hostDoc.getMap<Y.Map<unknown>>('nodes')
  const peerNodes = peerDoc.getMap<Y.Map<unknown>>('nodes')
  const hostImages = hostDoc.getMap<Uint8Array>('images')
  const peerImages = peerDoc.getMap<Uint8Array>('images')
  const hostMotions = hostDoc.getMap<Y.Map<unknown>>('motionTimelines')
  const peerMotions = peerDoc.getMap<Y.Map<unknown>>('motionTimelines')
  let hostSuppressYjsEvents = false
  let peerSuppressYjsEvents = false
  let hostSuppressGraphSync = false
  let peerSuppressGraphSync = false
  const hostMotionConflicts: MotionTimelineConflict[] = []
  const peerMotionConflicts: MotionTimelineConflict[] = []

  const hostSync = createYjsGraphSync({
    getStore: () => hostStore,
    getYdoc: () => hostDoc,
    getYnodes: () => hostNodes,
    getYimages: () => hostImages,
    getYmotions: () => hostMotions,
    getSuppressYjsEvents: () => hostSuppressYjsEvents,
    setSuppressYjsEvents: (value) => {
      hostSuppressYjsEvents = value
    },
    getMotionConflictHandler: () => (conflict) => hostMotionConflicts.push(conflict)
  })
  const peerSync = createYjsGraphSync({
    getStore: () => peerStore,
    getYdoc: () => peerDoc,
    getYnodes: () => peerNodes,
    getYimages: () => peerImages,
    getYmotions: () => peerMotions,
    getSuppressYjsEvents: () => peerSuppressYjsEvents,
    setSuppressYjsEvents: (value) => {
      peerSuppressYjsEvents = value
    },
    getMotionConflictHandler: () => (conflict) => peerMotionConflicts.push(conflict)
  })

  registerYjsObservers({
    store: hostStore,
    ynodes: hostNodes,
    yimages: hostImages,
    ymotions: hostMotions,
    getSuppressYjsEvents: () => hostSuppressYjsEvents,
    setSuppressGraphSync: (value) => {
      hostSuppressGraphSync = value
    },
    applyYjsToGraph: hostSync.applyYjsToGraph,
    applyYjsMotionToGraph: hostSync.applyYjsMotionToGraph
  })
  registerYjsObservers({
    store: peerStore,
    ynodes: peerNodes,
    yimages: peerImages,
    ymotions: peerMotions,
    getSuppressYjsEvents: () => peerSuppressYjsEvents,
    setSuppressGraphSync: (value) => {
      peerSuppressGraphSync = value
    },
    applyYjsToGraph: peerSync.applyYjsToGraph,
    applyYjsMotionToGraph: peerSync.applyYjsMotionToGraph
  })

  const disconnectYDocs =
    options.connectImmediately === false ? undefined : connectYDocs(hostDoc, peerDoc)

  return {
    hostStore,
    peerStore,
    hostDoc,
    peerDoc,
    hostSync,
    peerSync,
    hostNodes,
    hostMotions,
    peerMotions,
    hostMotionConflicts,
    peerMotionConflicts,
    get hostSuppressGraphSync() {
      return hostSuppressGraphSync
    },
    get peerSuppressGraphSync() {
      return peerSuppressGraphSync
    },
    cleanup: () => {
      disconnectYDocs?.()
      hostDoc.destroy()
      peerDoc.destroy()
    }
  }
}

function withSyncedStores(run: (stores: SyncedStores) => void, options: SyncedStoreOptions = {}) {
  const stores = createSyncedStores(options)
  try {
    run(stores)
  } finally {
    stores.cleanup()
  }
}

describe('collab yjs-sync', () => {
  test('createNodeWithId forces the requested id even if synced props contain a stale id', () => {
    const graph = new SceneGraph()
    const page = firstPage(graph)
    const node = graph.createNodeWithId('remote-id', 'RECTANGLE', page.id, {
      id: 'stale-local-id',
      width: 50
    })

    expect(node.id).toBe('remote-id')
    expect(graph.getNode('remote-id')).toBe(node)
    expect(graph.getNode('stale-local-id')).toBeUndefined()
    expect(page.childIds).toContain('remote-id')
  })

  test('excludes derived text pictures from collaboration payloads', () => {
    const graph = new SceneGraph()
    const page = firstPage(graph)
    const text = graph.createNode('TEXT', page.id, {
      text: 'Shared text',
      textPicture: new Uint8Array([4, 5, 6])
    })
    const doc = new Y.Doc()
    const ynode = new Y.Map<unknown>()
    doc.getMap<Y.Map<unknown>>('nodes').set(text.id, ynode)

    syncNodePropsToYMap(text, ynode)

    expect(ynode.has('textPicture')).toBe(false)
    ynode.set('textPicture', new Uint8Array([9]))
    expect(yNodeToProps(ynode).textPicture).toBeNull()
  })

  test('normalizes malformed source metadata and geometry at the remote boundary', () => {
    const doc = new Y.Doc()
    const ynode = new Y.Map<unknown>()
    doc.getMap<Y.Map<unknown>>('nodes').set('remote', ynode)
    ynode.set('source', { format: 'fig', fig: { rawNodeFields: 'invalid' } })
    ynode.set('fillGeometry', [
      {
        windingRule: 'EVENODD',
        commandsBlob: new Uint8Array([0]),
        fills: [
          null,
          'invalid',
          {
            type: 'GRADIENT_LINEAR',
            color: { r: 0, g: 0, b: 0, a: 1 },
            opacity: 1,
            visible: true,
            gradientStops: 'invalid'
          },
          {
            type: 'NOISE',
            color: { r: 0, g: 0, b: 0, a: 1 },
            opacity: 1,
            visible: true,
            noiseSize: 'invalid'
          },
          {
            type: 'GRADIENT_LINEAR',
            color: { r: 0, g: 0, b: 0, a: 1 },
            opacity: 0.8,
            visible: true,
            gradientStops: [
              { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
              { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
            ],
            gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
          },
          {
            type: 'SOLID',
            color: { r: 1, g: 0, b: 0, a: 1 },
            opacity: 1,
            visible: true
          }
        ]
      },
      { windingRule: 'NONZERO', commandsBlob: 'invalid' }
    ])
    ynode.set('strokeGeometry', 'invalid')

    const props = yNodeToProps(ynode)
    const source = props.source as SceneNode['source']
    const fillGeometry = props.fillGeometry as GeometryPath[]

    expect(source).toEqual({ ...createDefaultSourceMetadata(), format: 'fig' })
    expect(fillGeometry).toHaveLength(1)
    expect(fillGeometry[0]?.commandsBlob).toBeInstanceOf(Uint8Array)
    expect(fillGeometry[0]?.fills).toHaveLength(2)
    expect(fillGeometry[0]?.fills?.[0]).toMatchObject({
      type: 'GRADIENT_LINEAR',
      opacity: 0.8,
      gradientStops: [
        { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
        { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
      ],
      gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    })
    expect(fillGeometry[0]?.fills?.[1]?.type).toBe('SOLID')
    expect(props.strokeGeometry).toEqual([])
  })

  test('binary geometry fields round-trip as Uint8Array, not strings', () => {
    const host = new SceneGraph()
    const page = firstPage(host)
    const blob = new Uint8Array([1, 2, 3, 250])
    const geometry: GeometryPath[] = [{ windingRule: 'NONZERO', commandsBlob: blob }]
    const ellipse = host.createNode('ELLIPSE', page.id, {
      width: 100,
      height: 100,
      fillGeometry: geometry
    })

    const doc = new Y.Doc()
    const ynode = new Y.Map<unknown>()
    doc.getMap<Y.Map<unknown>>('nodes').set(ellipse.id, ynode)
    syncNodePropsToYMap(ellipse, ynode)
    blob[0] = 99
    const props = yNodeToProps(ynode)

    expect(typeof ynode.get('fillGeometry')).not.toBe('string')
    const decoded = props.fillGeometry as GeometryPath[]
    expect(Array.isArray(decoded)).toBe(true)
    const commandsBlob = expectDefined(decoded[0], 'decoded geometry path').commandsBlob
    expect(commandsBlob).toBeInstanceOf(Uint8Array)
    expect(Array.from(commandsBlob)).toEqual([1, 2, 3, 250])
    expect(Array.isArray(props.strokeGeometry)).toBe(true)
  })

  test('a fresh peer reconstructs one ellipse, no duplicate childIds, order-independent', () => {
    const host = new SceneGraph()
    const hostPage = firstPage(host)
    const ellipse = host.createNode('ELLIPSE', hostPage.id, { width: 80, height: 60 })

    const ynodes = seedHostIntoYjs(host)

    const peer = new SceneGraph()
    const ids = [...ynodes.keys()].reverse()
    for (const id of ids) applyYnodeToGraph(peer, id, expectDefined(ynodes.get(id), `ynode ${id}`))

    const peerEllipse = getNodeOrThrow(peer, ellipse.id)
    expect(peerEllipse.type).toBe('ELLIPSE')
    expect(peerEllipse.parentId).toBe(hostPage.id)

    const peerPage = getNodeOrThrow(peer, hostPage.id)
    const refs = peerPage.childIds.filter((c) => c === ellipse.id)
    expect(refs).toHaveLength(1)
    expect(peer.getPages().map((page) => page.id)).toContain(hostPage.id)
  })

  test('a live-created node links into its parent even when the parent childIds was not re-synced', () => {
    const host = new SceneGraph()
    const hostPage = firstPage(host)
    const rect = host.createNode('RECTANGLE', hostPage.id, { width: 50, height: 50 })

    const doc = new Y.Doc()
    const ynodes = doc.getMap<Y.Map<unknown>>('nodes')
    doc.transact(() => {
      const pageYnode = new Y.Map<unknown>()
      ynodes.set(hostPage.id, pageYnode)
      syncNodePropsToYMap({ ...hostPage, childIds: [] } as SceneNode, pageYnode)

      const rectYnode = new Y.Map<unknown>()
      ynodes.set(rect.id, rectYnode)
      syncNodePropsToYMap(rect, rectYnode)
    })

    const peer = new SceneGraph()
    applyYnodeToGraph(peer, hostPage.id, expectDefined(ynodes.get(hostPage.id), 'page ynode'))
    applyYnodeToGraph(peer, rect.id, expectDefined(ynodes.get(rect.id), 'rect ynode'))

    const peerPage = getNodeOrThrow(peer, hostPage.id)
    expect(peerPage.childIds).toEqual([rect.id])
    expect(getNodeOrThrow(peer, rect.id).type).toBe('RECTANGLE')
  })

  test('syncAllNodesToYjs populates peer graph and current page', () => {
    withSyncedStores(({ hostStore, peerStore, hostSync }) => {
      const hostPage = firstPage(hostStore.graph)
      const rect = hostStore.graph.createNode('RECTANGLE', hostPage.id, { width: 80, height: 60 })

      hostSync.syncAllNodesToYjs()

      expect(peerStore.graph.rootId).toBe(hostStore.graph.rootId)
      expect(peerStore.state.currentPageId).toBe(hostPage.id)
      expect(peerStore.graph.getPages().map((page) => page.id)).toContain(hostPage.id)
      expect(getNodeOrThrow(peerStore.graph, rect.id).type).toBe('RECTANGLE')
    })
  })

  test('live-created and edited nodes sync in both directions', () => {
    withSyncedStores(({ hostStore, peerStore, hostSync, peerSync }) => {
      const hostPage = firstPage(hostStore.graph)
      hostSync.syncAllNodesToYjs()

      const rect = hostStore.graph.createNode('RECTANGLE', hostPage.id, { width: 50, height: 50 })
      hostSync.syncNodeToYjs(rect.id)

      const peerRect = getNodeOrThrow(peerStore.graph, rect.id)
      expect(peerRect.parentId).toBe(hostPage.id)
      expect(getNodeOrThrow(peerStore.graph, hostPage.id).childIds).toContain(rect.id)

      peerStore.graph.updateNode(rect.id, { x: 42, y: 24 })
      peerSync.syncNodeToYjs(rect.id)

      expect(getNodeOrThrow(hostStore.graph, rect.id).x).toBe(42)
      expect(getNodeOrThrow(hostStore.graph, rect.id).y).toBe(24)
    })
  })

  test('unchanged node synchronization emits no Yjs update', () => {
    withSyncedStores(({ hostStore, hostSync, hostDoc }) => {
      const hostPage = firstPage(hostStore.graph)
      const rect = hostStore.graph.createNode('RECTANGLE', hostPage.id, { width: 80, height: 60 })
      hostSync.syncNodeToYjs(rect.id)

      let updateCount = 0
      let updateBytes = 0
      const trackUpdate = (update: Uint8Array) => {
        updateCount++
        updateBytes += update.byteLength
      }
      hostDoc.on('update', trackUpdate)
      for (let index = 0; index < 100; index++) hostSync.syncNodeToYjs(rect.id)
      hostDoc.off('update', trackUpdate)

      expect(updateCount).toBe(0)
      expect(updateBytes).toBe(0)
    })
  })

  test('repeated drag-like updates stay field-sized and do not echo', () => {
    withSyncedStores(({ hostStore, peerStore, hostSync, hostDoc, peerDoc }) => {
      const hostPage = firstPage(hostStore.graph)
      const rect = hostStore.graph.createNode('RECTANGLE', hostPage.id, { width: 80, height: 60 })
      hostSync.syncAllNodesToYjs()
      hostSync.syncNodeToYjs(rect.id)

      let hostUpdateCount = 0
      let hostUpdateBytes = 0
      let peerUpdateCount = 0
      const trackHostUpdate = (update: Uint8Array) => {
        hostUpdateCount++
        hostUpdateBytes += update.byteLength
      }
      const trackPeerUpdate = () => {
        peerUpdateCount++
      }
      hostDoc.on('update', trackHostUpdate)
      peerDoc.on('update', trackPeerUpdate)

      for (let index = 1; index <= 100; index++) {
        hostStore.graph.updateNode(rect.id, { x: index })
        hostSync.syncNodeToYjs(rect.id)
      }

      hostDoc.off('update', trackHostUpdate)
      peerDoc.off('update', trackPeerUpdate)
      expect(getNodeOrThrow(peerStore.graph, rect.id).x).toBe(100)
      expect(hostUpdateCount).toBe(100)
      expect(peerUpdateCount).toBe(100)
      expect(hostUpdateBytes).toBeLessThan(8_000)
    })
  })

  test('queued concurrent edits converge through the official Yjs test connector', () => {
    const connector = new TestConnector(createPRNG(526))
    const hostDoc: TestYInstance = connector.createY(1)
    const peerDoc: TestYInstance = connector.createY(2)
    connector.syncAll()

    withSyncedStores(
      ({ hostStore, peerStore, hostSync, peerSync }) => {
        const hostPage = firstPage(hostStore.graph)
        const rect = hostStore.graph.createNode('RECTANGLE', hostPage.id, {
          width: 80,
          height: 60
        })
        hostSync.syncAllNodesToYjs()
        hostSync.syncNodeToYjs(rect.id)
        connector.flushAllMessages()
        expect(getNodeOrThrow(peerStore.graph, rect.id).type).toBe('RECTANGLE')

        hostDoc.disconnect()
        hostStore.graph.updateNode(rect.id, { x: 42 })
        hostSync.syncNodeToYjs(rect.id)
        peerStore.graph.updateNode(rect.id, { y: 24 })
        peerSync.syncNodeToYjs(rect.id)

        hostDoc.connect()
        expect(connector.flushRandomMessage()).toBe(true)
        connector.flushAllMessages()

        expect(getNodeOrThrow(hostStore.graph, rect.id)).toMatchObject({ x: 42, y: 24 })
        expect(getNodeOrThrow(peerStore.graph, rect.id)).toMatchObject({ x: 42, y: 24 })
        expect(Y.encodeStateVector(hostDoc)).toEqual(Y.encodeStateVector(peerDoc))
      },
      { hostDoc, peerDoc, connectImmediately: false }
    )
  })

  test('optional motion fields are deleted from Yjs and both peer graphs', () => {
    withSyncedStores(({ hostStore, peerStore, hostSync, peerSync }) => {
      const hostPage = firstPage(hostStore.graph)
      hostSync.syncAllNodesToYjs()

      const rect = hostStore.graph.createNode('RECTANGLE', hostPage.id, {
        width: 50,
        height: 50,
        motion: createMotionPreset('slide-up')
      })
      hostSync.syncNodeToYjs(rect.id)

      const peerMotion = getNodeOrThrow(peerStore.graph, rect.id).motion
      expect(peerMotion?.preset?.id).toBe('slide-up')
      expect(peerMotion).not.toBe(rect.motion)

      hostStore.graph.clearNodeFields(rect.id, ['motion'])
      hostSync.syncNodeToYjs(rect.id)
      expect(getNodeOrThrow(peerStore.graph, rect.id).motion).toBeUndefined()
      expect(Object.hasOwn(getNodeOrThrow(peerStore.graph, rect.id), 'motion')).toBe(false)

      peerStore.graph.updateNode(rect.id, { motion: createMotionPreset('press') })
      peerSync.syncNodeToYjs(rect.id)
      expect(getNodeOrThrow(hostStore.graph, rect.id).motion?.preset?.id).toBe('press')

      peerStore.graph.clearNodeFields(rect.id, ['motion'])
      peerSync.syncNodeToYjs(rect.id)
      expect(getNodeOrThrow(hostStore.graph, rect.id).motion).toBeUndefined()
      expect(Object.hasOwn(getNodeOrThrow(hostStore.graph, rect.id), 'motion')).toBe(false)
    })
  })

  test('personal Motion snapshots and root instance overrides sync in both directions', () => {
    withSyncedStores(({ hostStore, peerStore, hostSync, peerSync }) => {
      const hostPage = firstPage(hostStore.graph)
      hostSync.syncAllNodesToYjs()
      const component = hostStore.graph.createNode('COMPONENT', hostPage.id, {
        name: 'Motion component'
      })
      const instance = hostStore.graph.createInstance(component.id, hostPage.id)
      if (!instance) throw new Error('Expected component instance')
      const personal: MotionSpec = {
        version: 2,
        tracks: [
          {
            id: 'personal-enter',
            trigger: 'mount',
            keyframes: [
              {
                offset: 0,
                opacity: 0,
                y: 20,
                width: 120,
                fillColor: { r: 1, g: 0.2, b: 0, a: 1 },
                pathProgress: 0
              },
              {
                offset: 1,
                opacity: 1,
                y: 0,
                width: 180,
                fillColor: { r: 0, g: 0.4, b: 1, a: 1 },
                pathProgress: 1
              }
            ],
            timing: {
              durationMs: 420,
              easing: { type: 'inertia', velocity: 10, deceleration: 0.2 }
            },
            path: {
              points: [
                { x: 0, y: 0 },
                { x: 80, y: 20 }
              ],
              autoRotate: true
            }
          }
        ],
        preset: { id: 'user-team-enter', version: 3, parameters: {} }
      }
      hostStore.graph.updateNode(instance.id, {
        motion: cloneMotionSpec(personal),
        overrides: { ...instance.overrides, motion: cloneMotionSpec(personal) }
      })
      hostSync.syncNodeToYjs(component.id)
      hostSync.syncNodeToYjs(instance.id)

      const peerInstance = getNodeOrThrow(peerStore.graph, instance.id)
      expect(peerInstance.motion).toEqual(personal)
      expect(peerInstance.motion).not.toBe(personal)
      expect(peerInstance.overrides.motion).toEqual(personal)
      expect(peerInstance.overrides.motion).not.toBe(peerInstance.motion)

      const changed = cloneMotionSpec(personal)
      changed.preset = { id: 'user-team-enter', version: 4, parameters: {} }
      changed.tracks[0].timing.durationMs = 640
      peerStore.graph.updateNode(instance.id, {
        motion: cloneMotionSpec(changed),
        overrides: { ...peerInstance.overrides, motion: cloneMotionSpec(changed) }
      })
      peerSync.syncNodeToYjs(instance.id)

      const hostInstance = getNodeOrThrow(hostStore.graph, instance.id)
      expect(hostInstance.motion).toEqual(changed)
      expect(hostInstance.overrides.motion).toEqual(changed)
      expect(hostInstance.overrides.motion).not.toBe(hostInstance.motion)
    })
  })

  test('MotionSpec v3 migrates stable keyframe ids and syncs outside the opaque node map', () => {
    withSyncedStores(({ hostStore, peerStore, hostSync, hostNodes, hostMotions }) => {
      const hostPage = firstPage(hostStore.graph)
      hostSync.syncAllNodesToYjs()
      const rect = hostStore.graph.createNode('RECTANGLE', hostPage.id, {
        motion: {
          version: 3,
          tracks: [
            {
              id: 'enter',
              trigger: 'mount',
              keyframes: [
                { offset: 0, opacity: 0 },
                { offset: 1, opacity: 1 }
              ],
              timing: { durationMs: 300 }
            }
          ]
        }
      })

      hostSync.syncNodeToYjs(rect.id)

      const hostMotion = getNodeOrThrow(hostStore.graph, rect.id).motion
      const peerMotion = getNodeOrThrow(peerStore.graph, rect.id).motion
      expect(hostMotion?.version).toBe(3)
      expect(hostMotion?.tracks[0].keyframes.every(({ id }) => Boolean(id))).toBe(true)
      expect(peerMotion).toEqual(hostMotion)
      expect(hostNodes.get(rect.id)?.has('motion')).toBe(false)
      expect(hostMotions.get(rect.id)?.get('tracks')).toBeInstanceOf(Y.Map)
    })
  })

  test('inherited P2 instance fields never become a stale collaborative second source', () => {
    withSyncedStores(
      ({ hostStore, peerStore, hostSync, peerSync, hostNodes, hostMotions, peerMotions }) => {
        const page = firstPage(hostStore.graph)
        hostSync.syncAllNodesToYjs()
        const initialMotion = v3Motion('master-initial', 24)
        const component = hostStore.graph.createNode('COMPONENT', page.id, {
          name: 'P2 collaboration master',
          motion: initialMotion,
          motionScene: motionScene(page.id, 'master-initial'),
          motionDrivers: motionDrivers(page.id, 'master-initial'),
          prototype: prototype(page.id),
          transitionKey: 'master-initial',
          generatedEffect: generatedEffect('noise')
        })
        const instance = expectDefined(
          hostStore.graph.createInstance(component.id, page.id),
          'inherited instance'
        )
        hostSync.syncNodeToYjs(component.id)
        hostSync.syncNodeToYjs(instance.id)

        const yinstance = expectDefined(hostNodes.get(instance.id), 'instance Y.Map')
        for (const field of [
          'motion',
          'motionScene',
          'motionDrivers',
          'prototype',
          'transitionKey',
          'generatedEffect'
        ]) {
          expect(yinstance.has(field)).toBe(false)
        }
        expect(hostMotions.has(instance.id)).toBe(false)
        expect(peerMotions.has(instance.id)).toBe(false)

        const updatedMotion = v3Motion('master-updated', 96)
        hostStore.graph.updateNode(component.id, {
          motion: updatedMotion,
          transitionKey: 'master-updated'
        })
        hostStore.graph.clearNodeFields(component.id, [
          'motionScene',
          'motionDrivers',
          'prototype',
          'generatedEffect'
        ])
        hostStore.graph.syncInstances(component.id)
        hostSync.syncNodeToYjs(component.id)

        const peerInstance = getNodeOrThrow(peerStore.graph, instance.id)
        peerStore.graph.updateNode(instance.id, { name: 'Unrelated remote rename' })
        peerSync.syncNodeToYjs(instance.id)

        const hostInstance = getNodeOrThrow(hostStore.graph, instance.id)
        expect(hostInstance.name).toBe('Unrelated remote rename')
        expect(hostInstance.motion).toEqual(updatedMotion)
        expect(hostInstance.transitionKey).toBe('master-updated')
        expect(hostInstance.motionScene).toBeUndefined()
        expect(hostInstance.motionDrivers).toBeUndefined()
        expect(hostInstance.prototype).toBeUndefined()
        expect(hostInstance.generatedEffect).toBeUndefined()
        expect(peerInstance.overrides).toEqual({})
        expect(hostMotions.has(instance.id)).toBe(false)
        expect(peerMotions.has(instance.id)).toBe(false)
        for (const field of [
          'motion',
          'motionScene',
          'motionDrivers',
          'prototype',
          'transitionKey',
          'generatedEffect'
        ]) {
          expect(yinstance.has(field)).toBe(false)
        }
      }
    )
  })

  test('explicit instance Motion and generated-effect overrides remain independent concurrently', () => {
    withSyncedStores(({ hostStore, peerStore, hostSync, peerSync, hostNodes, hostMotions }) => {
      const page = firstPage(hostStore.graph)
      hostSync.syncAllNodesToYjs()
      const component = hostStore.graph.createNode('COMPONENT', page.id, {
        name: 'Explicit P2 master',
        motion: v3Motion('master', 16),
        generatedEffect: generatedEffect('noise')
      })
      const instance = expectDefined(
        hostStore.graph.createInstance(component.id, page.id),
        'explicit instance'
      )
      const customMotion = v3Motion('custom', 48)
      const customEffect = generatedEffect('shimmer')
      hostStore.graph.updateNode(instance.id, {
        motion: cloneMotionSpec(customMotion),
        generatedEffect: structuredClone(customEffect),
        overrides: {
          ...instance.overrides,
          motion: cloneMotionSpec(customMotion),
          generatedEffect: structuredClone(customEffect)
        }
      })
      hostSync.syncNodeToYjs(component.id)
      hostSync.syncNodeToYjs(instance.id)

      hostStore.graph.updateNode(component.id, { motion: v3Motion('master-updated', 120) })
      hostStore.graph.clearNodeFields(component.id, ['generatedEffect'])
      hostStore.graph.syncInstances(component.id)
      hostSync.syncNodeToYjs(component.id)

      const peerInstance = getNodeOrThrow(peerStore.graph, instance.id)
      const peerMotion = v3Motion('custom-peer', 72)
      const peerEffect = generatedEffect('particles')
      peerStore.graph.updateNode(instance.id, {
        name: 'Concurrent explicit edit',
        motion: cloneMotionSpec(peerMotion),
        generatedEffect: structuredClone(peerEffect),
        overrides: {
          ...peerInstance.overrides,
          motion: cloneMotionSpec(peerMotion),
          generatedEffect: structuredClone(peerEffect)
        }
      })
      peerSync.syncNodeToYjs(instance.id)

      const hostInstance = getNodeOrThrow(hostStore.graph, instance.id)
      expect(hostInstance.motion).toEqual(peerMotion)
      expect(hostInstance.generatedEffect).toEqual(peerEffect)
      expect(hostInstance.overrides.motion).toEqual(peerMotion)
      expect(hostInstance.overrides.generatedEffect).toEqual(peerEffect)
      expect(hostMotions.has(instance.id)).toBe(true)
      expect(hostNodes.get(instance.id)?.has('motion')).toBe(false)
      expect(hostNodes.get(instance.id)?.has('generatedEffect')).toBe(true)
    })
  })

  test('remote Motion updates checkpoint live caps and unsafe payloads without observer re-entry', () => {
    withSyncedStores((stores) => {
      const {
        hostStore,
        peerStore,
        hostDoc,
        hostSync,
        hostMotions,
        peerMotions,
        hostMotionConflicts
      } = stores
      const hostPage = firstPage(hostStore.graph)
      hostSync.syncAllNodesToYjs()
      const rect = hostStore.graph.createNode('RECTANGLE', hostPage.id, {
        motion: {
          version: 3,
          tracks: [
            {
              id: 'enter',
              trigger: 'mount',
              keyframes: [
                { offset: 0, opacity: 0 },
                { offset: 1, opacity: 1 }
              ],
              timing: { durationMs: 300 }
            }
          ]
        }
      })
      hostSync.syncNodeToYjs(rect.id)

      const attacker = new Y.Doc()
      Y.applyUpdate(attacker, Y.encodeStateAsUpdate(hostDoc))
      const attackerTimeline = attacker
        .getMap<Y.Map<unknown>>('motionTimelines')
        .get(rect.id) as Y.Map<unknown>
      const attackerTracks = attackerTimeline.get('tracks') as Y.Map<Y.Map<unknown>>
      attacker.transact(() => {
        const enter = attackerTracks.get('enter') as Y.Map<unknown>
        enter.set('unknownExecutableField', { source: 'alert(1)' })
        enter.set(
          'path',
          Array.from({ length: MOTION_TIMELINE_CRDT_LIMITS.maxArrayEntries + 1 }, () => 0)
        )
        for (
          let index = 0;
          index < MOTION_TIMELINE_CRDT_LIMITS.maxStoredTracksPerNode + 5;
          index++
        ) {
          const track = new Y.Map<unknown>()
          track.set('id', `remote-${index}`)
          track.set('order', index + 1)
          track.set('trigger', 'mount')
          const timing = new Y.Map<unknown>()
          timing.set('durationMs', 300)
          track.set('timing', timing)
          const frames = new Y.Map<Y.Map<unknown>>()
          for (let frameIndex = 0; frameIndex < 2; frameIndex++) {
            const frame = new Y.Map<unknown>()
            frame.set('id', `remote-${index}-frame-${frameIndex}`)
            frame.set('order', frameIndex)
            frame.set('offset', frameIndex)
            frame.set('opacity', frameIndex)
            frames.set(`remote-${index}-frame-${frameIndex}`, frame)
          }
          track.set('keyframes', frames)
          attackerTracks.set(`remote-${index}`, track)
        }
      })

      Y.applyUpdate(hostDoc, Y.encodeStateAsUpdate(attacker), 'remote-test')

      const hostTracks = hostMotions.get(rect.id)?.get('tracks') as Y.Map<Y.Map<unknown>>
      const peerTracks = peerMotions.get(rect.id)?.get('tracks') as Y.Map<Y.Map<unknown>>
      expect(hostTracks.size).toBe(MOTION_TIMELINE_CRDT_LIMITS.maxStoredTracksPerNode)
      expect(peerTracks.size).toBe(MOTION_TIMELINE_CRDT_LIMITS.maxStoredTracksPerNode)
      expect([...hostTracks.keys()].sort()).toEqual([...peerTracks.keys()].sort())
      expect(hostTracks.get('enter')?.has('unknownExecutableField')).toBe(false)
      expect(hostTracks.get('enter')?.has('path')).toBe(false)
      expect(getNodeOrThrow(hostStore.graph, rect.id).motion?.tracks[0].id).toBe('enter')
      expect(getNodeOrThrow(peerStore.graph, rect.id).motion).toEqual(
        getNodeOrThrow(hostStore.graph, rect.id).motion
      )
      expect(hostMotionConflicts.some(({ code }) => code === 'resource-limit')).toBe(true)
      expect(hostMotionConflicts.some(({ code }) => code === 'invalid-timeline')).toBe(true)
      expect(stores.hostSuppressGraphSync).toBe(false)
      expect(stores.peerSuppressGraphSync).toBe(false)
      attacker.destroy()
    })
  })

  test('observer registration checkpoints and hydrates pre-existing Motion timelines', () => {
    const store = createEditorStore(new SceneGraph())
    const page = firstPage(store.graph)
    const rect = store.graph.createNode('RECTANGLE', page.id)
    const doc = new Y.Doc()
    const ynodes = doc.getMap<Y.Map<unknown>>('nodes')
    const yimages = doc.getMap<Uint8Array>('images')
    const ymotions = doc.getMap<Y.Map<unknown>>('motionTimelines')
    const timeline = new Y.Map<unknown>()
    ymotions.set(rect.id, timeline)
    syncMotionSpecToYMap(
      {
        version: 3,
        tracks: [
          {
            id: 'hydrate',
            trigger: 'mount',
            keyframes: [
              { offset: 0, opacity: 0 },
              { offset: 1, opacity: 1 }
            ],
            timing: { durationMs: 300 }
          }
        ]
      },
      timeline
    )
    const track = (timeline.get('tracks') as Y.Map<Y.Map<unknown>>).get('hydrate') as Y.Map<unknown>
    track.set('unknownExecutableField', { source: 'alert(1)' })
    track.set(
      'path',
      Array.from({ length: MOTION_TIMELINE_CRDT_LIMITS.maxArrayEntries + 1 }, () => 0)
    )

    let suppressYjsEvents = false
    let suppressGraphSync = false
    const conflicts: MotionTimelineConflict[] = []
    const sync = createYjsGraphSync({
      getStore: () => store,
      getYdoc: () => doc,
      getYnodes: () => ynodes,
      getYimages: () => yimages,
      getYmotions: () => ymotions,
      getSuppressYjsEvents: () => suppressYjsEvents,
      setSuppressYjsEvents: (value) => {
        suppressYjsEvents = value
      },
      getMotionConflictHandler: () => (conflict) => conflicts.push(conflict)
    })

    registerYjsObservers({
      store,
      ynodes,
      yimages,
      ymotions,
      getSuppressYjsEvents: () => suppressYjsEvents,
      setSuppressGraphSync: (value) => {
        suppressGraphSync = value
      },
      applyYjsToGraph: sync.applyYjsToGraph,
      applyYjsMotionToGraph: sync.applyYjsMotionToGraph
    })

    expect(track.has('unknownExecutableField')).toBe(false)
    expect(track.has('path')).toBe(false)
    expect(getNodeOrThrow(store.graph, rect.id).motion?.tracks[0].id).toBe('hydrate')
    expect(conflicts.some(({ code }) => code === 'resource-limit')).toBe(true)
    expect(conflicts.some(({ code }) => code === 'invalid-timeline')).toBe(true)
    expect(suppressYjsEvents).toBe(false)
    expect(suppressGraphSync).toBe(false)
    doc.destroy()
  })

  test('hydrate bounds timeline owners before decode and removes hundreds of orphans', () => {
    const store = createEditorStore(new SceneGraph())
    const page = firstPage(store.graph)
    const doc = new Y.Doc()
    const ynodes = doc.getMap<Y.Map<unknown>>('nodes')
    const yimages = doc.getMap<Uint8Array>('images')
    const ymotions = doc.getMap<Y.Map<unknown>>('motionTimelines')
    const graphIds = Array.from(
      { length: 4 },
      (_, index) => `zz-graph-${String(index).padStart(4, '0')}`
    )
    for (const nodeId of graphIds) {
      store.graph.createNodeWithId(nodeId, 'RECTANGLE', page.id, { name: nodeId })
      addStoredTimeline(ymotions, nodeId)
    }

    const component = store.graph.createNode('COMPONENT', page.id, {
      motion: v3Motion('legacy-master', 12)
    })
    const legacyInstance = expectDefined(
      store.graph.createInstance(component.id, page.id),
      'legacy derived instance'
    )
    addStoredTimeline(ymotions, legacyInstance.id, v3Motion('legacy-derived', 99))

    const pendingCount = MOTION_TIMELINE_CRDT_LIMITS.maxStoredTimelineNodes - graphIds.length + 1
    const pendingIds = Array.from(
      { length: pendingCount },
      (_, index) => `aa-pending-${String(index).padStart(4, '0')}`
    )
    doc.transact(() => {
      for (const nodeId of pendingIds.toReversed()) {
        const ynode = new Y.Map<unknown>()
        ynodes.set(nodeId, ynode)
        ynode.set('type', 'RECTANGLE')
        addStoredTimeline(ymotions, nodeId)
      }
      for (let index = 0; index < 400; index++) {
        ymotions.set(`orphan-${String(index).padStart(4, '0')}`, new Y.Map<unknown>())
      }
    })

    let suppressYjsEvents = false
    let suppressGraphSync = false
    const conflicts: MotionTimelineConflict[] = []
    const sync = createYjsGraphSync({
      getStore: () => store,
      getYdoc: () => doc,
      getYnodes: () => ynodes,
      getYimages: () => yimages,
      getYmotions: () => ymotions,
      getSuppressYjsEvents: () => suppressYjsEvents,
      setSuppressYjsEvents: (value) => {
        suppressYjsEvents = value
      },
      getMotionConflictHandler: () => (conflict) => conflicts.push(conflict)
    })

    registerYjsObservers({
      store,
      ynodes,
      yimages,
      ymotions,
      getSuppressYjsEvents: () => suppressYjsEvents,
      setSuppressGraphSync: (value) => {
        suppressGraphSync = value
      },
      applyYjsToGraph: sync.applyYjsToGraph,
      applyYjsMotionToGraph: sync.applyYjsMotionToGraph
    })

    const pendingCapacity = MOTION_TIMELINE_CRDT_LIMITS.maxStoredTimelineNodes - graphIds.length
    const expectedIds = [...graphIds, ...pendingIds.slice(0, pendingCapacity)].sort()
    expect([...ymotions.keys()].sort()).toEqual(expectedIds)
    expect(ymotions.size).toBe(MOTION_TIMELINE_CRDT_LIMITS.maxStoredTimelineNodes)
    expect(ymotions.has(pendingIds[pendingIds.length - 1])).toBe(false)
    expect(ymotions.has(legacyInstance.id)).toBe(false)
    expect([...ymotions.keys()].some((nodeId) => nodeId.startsWith('orphan-'))).toBe(false)
    expect(getNodeOrThrow(store.graph, graphIds[0]).motion?.tracks[0].id).toBe('bounded')
    const documentConflicts = conflicts.filter(
      ({ nodeId, code }) => nodeId === '$document' && code === 'resource-limit'
    )
    expect(documentConflicts).toHaveLength(1)
    expect(documentConflicts[0].message).toContain('400 orphan')
    expect(documentConflicts[0].message).toContain('1 derived instance')
    expect(suppressYjsEvents).toBe(false)
    expect(suppressGraphSync).toBe(false)
    doc.destroy()
  })

  test('remote top-level timeline flood converges to the physical document cap', () => {
    withSyncedStores((stores) => {
      const {
        hostStore,
        hostDoc,
        peerDoc,
        hostSync,
        hostMotions,
        peerMotions,
        hostMotionConflicts,
        peerMotionConflicts
      } = stores
      const page = firstPage(hostStore.graph)
      hostSync.syncAllNodesToYjs()
      const attacker = new Y.Doc()
      Y.applyUpdate(attacker, Y.encodeStateAsUpdate(hostDoc))
      const attackerNodes = attacker.getMap<Y.Map<unknown>>('nodes')
      const attackerMotions = attacker.getMap<Y.Map<unknown>>('motionTimelines')
      const remoteIds = Array.from(
        { length: MOTION_TIMELINE_CRDT_LIMITS.maxStoredTimelineNodes + 1 },
        (_, index) => `remote-${String(index).padStart(4, '0')}`
      )
      attacker.transact(() => {
        for (const nodeId of remoteIds.toReversed()) {
          const ynode = new Y.Map<unknown>()
          attackerNodes.set(nodeId, ynode)
          ynode.set('type', 'RECTANGLE')
          ynode.set('parentId', page.id)
          ynode.set('name', nodeId)
          addStoredTimeline(attackerMotions, nodeId)
        }
        for (let index = 0; index < 300; index++) {
          attackerMotions.set(
            `remote-orphan-${String(index).padStart(4, '0')}`,
            new Y.Map<unknown>()
          )
        }
      })

      Y.applyUpdate(hostDoc, Y.encodeStateAsUpdate(attacker), 'remote-document-flood')
      Y.applyUpdate(hostDoc, Y.encodeStateAsUpdate(peerDoc))
      Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(hostDoc))

      const expectedIds = remoteIds.slice(0, -1).sort()
      expect([...hostMotions.keys()].sort()).toEqual(expectedIds)
      expect([...peerMotions.keys()].sort()).toEqual(expectedIds)
      expect(hostMotions.size).toBe(MOTION_TIMELINE_CRDT_LIMITS.maxStoredTimelineNodes)
      expect(peerMotions.size).toBe(MOTION_TIMELINE_CRDT_LIMITS.maxStoredTimelineNodes)
      expect([...hostMotions.keys()].some((nodeId) => nodeId.startsWith('remote-orphan-'))).toBe(
        false
      )
      expect(hostMotionConflicts.filter(({ nodeId }) => nodeId === '$document')).toHaveLength(1)
      expect(peerMotionConflicts.filter(({ nodeId }) => nodeId === '$document')).toHaveLength(1)
      expect(stores.hostSuppressGraphSync).toBe(false)
      expect(stores.peerSuppressGraphSync).toBe(false)
      attacker.destroy()
    })
  })

  test('image fills sync image bytes', () => {
    withSyncedStores(({ hostStore, peerStore, hostSync }) => {
      const hostPage = firstPage(hostStore.graph)
      const imageHash = 'image-hash'
      const imageFill: Fill = {
        type: 'IMAGE',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        imageHash,
        imageScaleMode: 'FILL'
      }
      const rect = hostStore.graph.createNode('RECTANGLE', hostPage.id, { fills: [imageFill] })
      hostStore.graph.images.set(imageHash, new Uint8Array([9, 8, 7]))

      hostSync.syncNodeToYjs(rect.id)

      expect(
        Array.from(expectDefined(peerStore.graph.images.get(imageHash), 'peer image'))
      ).toEqual([9, 8, 7])
    })
  })

  test('synced node does not crash the visual-bounds helper', () => {
    const host = new SceneGraph()
    const hostPage = firstPage(host)
    const ellipse = host.createNode('ELLIPSE', hostPage.id, { width: 120, height: 90 })

    const ynodes = seedHostIntoYjs(host)
    const peer = new SceneGraph()
    for (const id of ynodes.keys()) {
      applyYnodeToGraph(peer, id, expectDefined(ynodes.get(id), `ynode ${id}`))
    }

    const peerEllipse = getNodeOrThrow(peer, ellipse.id)
    expect(() =>
      nodeVisualBounds(peerEllipse, (id) => {
        const n = peer.getNode(id)
        return { x: n?.x ?? 0, y: n?.y ?? 0 }
      })
    ).not.toThrow()
  })
})
