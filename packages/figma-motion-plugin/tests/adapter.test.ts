import { describe, expect, test } from 'bun:test'

import {
  FIGMA_MOTION_SHARED_KEY,
  FIGMA_MOTION_SHARED_NAMESPACE,
  FIGMA_NATIVE_MOTION_OWNERSHIP_KEY,
  FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE,
  applyFigmaNativeMotionTransaction as sharedApplyFigmaNativeMotionTransaction,
  encodeFigmaMotionSharedClearEnvelope,
  encodeFigmaMotionSharedEnvelope,
  type FigmaNativeMotionFieldName
} from '@open-pencil/fig'

import { runFigmaMotionAdapter } from '../src/run'
import { applyFigmaNativeMotionTransaction as pluginApplyFigmaNativeMotionTransaction } from '../src/transaction'
import type { FigmaMotionSelectionHost, FigmaMotionTarget } from '../src/types'

interface MutableKeyframe {
  id: string
  timelinePosition: number
  easing: MotionEasing
  value: KeyframeValue
}

interface MutableBinding {
  id: string
  baseValue: KeyframeValue
  keyframes: MutableKeyframe[]
}

interface MockNodeSnapshot {
  animationStyles: Array<Pick<AppliedAnimationStyle, 'id'>>
  manualKeyframeTracks: ManualKeyframeTracks
  timelines: Timeline[]
  shared: Array<[string, string]>
}

class MockMotionNode implements FigmaMotionTarget {
  readonly id: string
  readonly name: string
  readonly opacity?: number
  animationStyles: Array<Pick<AppliedAnimationStyle, 'id'>> = []
  manualKeyframeTracks: ManualKeyframeTracks = {}
  timelines: Timeline[] = []
  failField?: FigmaNativeMotionFieldName
  corruptField?: FigmaNativeMotionFieldName
  exposeTimeline = true
  failOwnershipWrite = false
  private readonly shared = new Map<string, string>()

  constructor(id: string, opacity = 0.8) {
    this.id = id
    this.name = `Node ${id}`
    this.opacity = opacity
  }

  applyManualKeyframeTrack(field: KeyframeField, track: ManualKeyframeTrackInput): void {
    if (field.type !== 'PROPERTY') throw new Error('Mock only supports property tracks')
    if (this.failField === field.name) throw new Error(`apply failed for ${field.name}`)

    const binding: MutableBinding = {
      id: `binding:${field.name}`,
      baseValue: structuredClone(track.baseValue ?? { type: 'FLOAT', value: 0 }),
      keyframes: track.keyframes.map((frame, index) => ({
        id: `${field.name}:${index}`,
        timelinePosition: frame.timelinePosition,
        easing: structuredClone(frame.easing ?? { type: 'LINEAR' }),
        value: structuredClone(frame.value)
      }))
    }
    if (this.corruptField === field.name) {
      const value = binding.keyframes[0]?.value
      if (value?.type === 'FLOAT') value.value += 1
    }
    this.trackStore()[field.name] = binding

    if (this.exposeTimeline && !this.timelines[0]) {
      this.timelines = [
        {
          id: 'timeline:1',
          duration: binding.keyframes.at(-1)?.timelinePosition ?? 0.001
        }
      ]
    }
  }

  removeManualKeyframeTrack(field: KeyframeField): void {
    if (field.type !== 'PROPERTY') throw new Error('Mock only supports property tracks')
    Reflect.deleteProperty(this.trackStore(), field.name)
  }

  setTimelineDuration(id: string, duration: number): void {
    const timeline = this.timelines.find((candidate) => candidate.id === id)
    if (!timeline) throw new Error(`timeline ${id} not found`)
    ;(timeline as { duration: number }).duration = duration
  }

  getSharedPluginData(namespace: string, key: string): string {
    return this.shared.get(`${namespace}:${key}`) ?? ''
  }

  setSharedPluginData(namespace: string, key: string, value: string): void {
    if (
      this.failOwnershipWrite &&
      namespace === FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE &&
      key === FIGMA_NATIVE_MOTION_OWNERSHIP_KEY
    ) {
      throw new Error('ownership marker write failed')
    }
    this.shared.set(`${namespace}:${key}`, value)
  }

  setMotionEnvelope(value: unknown): void {
    this.setSharedPluginData(
      FIGMA_MOTION_SHARED_NAMESPACE,
      FIGMA_MOTION_SHARED_KEY,
      encodeFigmaMotionSharedEnvelope(value)
    )
  }

  setMotionClear(): void {
    this.setSharedPluginData(
      FIGMA_MOTION_SHARED_NAMESPACE,
      FIGMA_MOTION_SHARED_KEY,
      encodeFigmaMotionSharedClearEnvelope()
    )
  }

  snapshot(): MockNodeSnapshot {
    return structuredClone({
      animationStyles: this.animationStyles,
      manualKeyframeTracks: this.manualKeyframeTracks,
      timelines: this.timelines,
      shared: [...this.shared.entries()]
    })
  }

  restore(snapshot: MockNodeSnapshot): void {
    this.animationStyles = structuredClone(snapshot.animationStyles)
    this.manualKeyframeTracks = structuredClone(snapshot.manualKeyframeTracks)
    this.timelines = structuredClone(snapshot.timelines)
    this.shared.clear()
    for (const [key, value] of snapshot.shared) this.shared.set(key, value)
  }

  private trackStore(): Record<string, MutableBinding | undefined> {
    return this.manualKeyframeTracks as Record<string, MutableBinding | undefined>
  }
}

class MockFigma implements FigmaMotionSelectionHost {
  readonly currentPage: { selection: MockMotionNode[] }
  commitCount = 0
  rollbackCount = 0
  private undoSnapshot?: MockNodeSnapshot[]

  constructor(
    readonly nodes: MockMotionNode[],
    private readonly restoreOnUndo = true
  ) {
    this.currentPage = { selection: nodes }
  }

  commitUndo(): void {
    this.commitCount++
    this.undoSnapshot = this.nodes.map((node) => node.snapshot())
  }

  triggerUndo(): void {
    this.rollbackCount++
    const snapshot = this.undoSnapshot
    if (!snapshot) throw new Error('missing undo snapshot')
    if (this.restoreOnUndo) {
      this.nodes.forEach((node, index) => {
        const nodeSnapshot = snapshot[index]
        if (!nodeSnapshot) throw new Error(`missing undo snapshot for node ${node.id}`)
        node.restore(nodeSnapshot)
      })
    }
  }
}

function motion(channels: 'opacity' | 'slide' = 'slide', durationMs = 400) {
  return {
    version: 1,
    tracks: [
      {
        id: 'entrance',
        trigger: 'mount',
        keyframes:
          channels === 'slide'
            ? [
                { offset: 0, opacity: 0, x: -12 },
                { offset: 1, opacity: 1, x: 0 }
              ]
            : [
                { offset: 0, opacity: 0 },
                { offset: 1, opacity: 1 }
              ],
        timing: { durationMs, fill: 'both' },
        exit: 'none'
      }
    ]
  }
}

function seedPropertyTrack(node: MockMotionNode, name: KeyframePropertyFieldName): void {
  node.applyManualKeyframeTrack(
    { type: 'PROPERTY', name },
    {
      baseValue: { type: 'FLOAT', value: 0 },
      keyframes: [
        { timelinePosition: 0, value: { type: 'FLOAT', value: 0 } },
        { timelinePosition: 0.4, value: { type: 'FLOAT', value: 1 } }
      ]
    }
  )
}

describe('Figma Motion selection runner', () => {
  test('uses the identity-preserving shared @open-pencil/fig transaction', () => {
    expect(pluginApplyFigmaNativeMotionTransaction).toBe(sharedApplyFigmaNativeMotionTransaction)
  })

  test('scans the selection, applies once, then reports an unchanged owned state', () => {
    const node = new MockMotionNode('4:1')
    node.setMotionEnvelope(motion())

    const firstHost = new MockFigma([node])
    const first = runFigmaMotionAdapter(firstHost)
    expect(first).toMatchObject({
      schema: 'openpencil.figma-motion-adapter-result',
      version: 1,
      conflictPolicy: 'replace-owned',
      selectionCount: 1,
      counts: { applied: 1, unchanged: 0, conflict: 0, failed: 0 }
    })
    expect(first.results[0]).toMatchObject({
      status: 'applied',
      managedFields: ['OPACITY', 'TRANSLATION_X'],
      timelineId: 'timeline:1',
      durationSeconds: 0.4
    })
    expect(firstHost.commitCount).toBe(2)
    expect(firstHost.rollbackCount).toBe(0)
    expect(
      node.getSharedPluginData(
        FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE,
        FIGMA_NATIVE_MOTION_OWNERSHIP_KEY
      )
    ).not.toBe('')

    const secondHost = new MockFigma([node])
    const second = runFigmaMotionAdapter(secondHost)
    expect(second.results[0]).toMatchObject({ status: 'unchanged', nodeId: '4:1' })
    expect(secondHost.commitCount).toBe(0)
  })

  test('keeps timeline growth disabled at the plugin entry point', () => {
    const node = new MockMotionNode('4:2')
    node.timelines = [{ id: 'timeline:1', duration: 0.1 }]
    node.setMotionEnvelope(motion('opacity'))
    const before = node.snapshot()
    const host = new MockFigma([node])

    expect(runFigmaMotionAdapter(host).results[0]).toMatchObject({
      status: 'conflict',
      code: 'timeline-growth-required'
    })
    expect(host.commitCount).toBe(0)
    expect(node.snapshot()).toEqual(before)
  })

  test('strictly decodes every selected node and returns per-node counts', () => {
    const missing = new MockMotionNode('5:1')
    const malformed = new MockMotionNode('5:2')
    malformed.setSharedPluginData(
      FIGMA_MOTION_SHARED_NAMESPACE,
      FIGMA_MOTION_SHARED_KEY,
      JSON.stringify({
        schema: 'openpencil.motion',
        version: 1,
        motion: motion(),
        extra: true
      })
    )
    const unsupported = new MockMotionNode('5:3')
    const hover = motion()
    const [hoverTrack] = hover.tracks
    if (!hoverTrack) throw new Error('missing hover fixture track')
    hoverTrack.trigger = 'hover'
    unsupported.setMotionEnvelope(hover)

    const host = new MockFigma([missing, malformed, unsupported])
    const summary = runFigmaMotionAdapter(host)

    expect(summary.counts).toEqual({
      applied: 0,
      unchanged: 0,
      skipped: 1,
      unsupported: 1,
      conflict: 0,
      failed: 1
    })
    expect(summary.results.map(({ status, code }) => ({ status, code }))).toEqual([
      { status: 'skipped', code: 'no-shared-motion' },
      { status: 'failed', code: 'invalid-envelope' },
      { status: 'unsupported', code: 'unsupported-motion' }
    ])
    expect(host.commitCount).toBe(0)
  })

  test('updates only verified owned fields and removes stale owned channels', () => {
    const node = new MockMotionNode('6:1')
    node.setMotionEnvelope(motion('slide'))
    expect(runFigmaMotionAdapter(new MockFigma([node])).results[0]?.status).toBe('applied')
    expect(node.manualKeyframeTracks.TRANSLATION_X).toBeDefined()

    node.setMotionEnvelope(motion('opacity'))
    expect(runFigmaMotionAdapter(new MockFigma([node])).results[0]?.status).toBe('applied')
    expect(node.manualKeyframeTracks.OPACITY).toBeDefined()
    expect(node.manualKeyframeTracks.TRANSLATION_X).toBeUndefined()
  })

  test('treats a clear envelope as a tombstone, not native-track deletion authority', () => {
    const node = new MockMotionNode('6:2')
    seedPropertyTrack(node, 'WIDTH')
    node.setMotionClear()
    const before = node.snapshot()
    const host = new MockFigma([node])

    expect(runFigmaMotionAdapter(host).results[0]).toMatchObject({
      status: 'skipped',
      code: 'motion-cleared',
      message: expect.stringContaining('does not authorize deleting')
    })
    expect(host.commitCount).toBe(0)
    expect(node.snapshot()).toEqual(before)
  })

  test('rolls back partial track and ownership-marker failures only after verified restore', () => {
    const applyFailure = new MockMotionNode('6:3')
    applyFailure.setMotionEnvelope(motion())
    applyFailure.failField = 'TRANSLATION_X'
    const applyBefore = applyFailure.snapshot()
    const applyHost = new MockFigma([applyFailure])

    expect(runFigmaMotionAdapter(applyHost).results[0]).toMatchObject({
      status: 'failed',
      code: 'apply-failed',
      rolledBack: true
    })
    expect(applyHost.rollbackCount).toBe(1)
    expect(applyFailure.snapshot()).toEqual(applyBefore)

    const markerFailure = new MockMotionNode('6:4')
    markerFailure.setMotionEnvelope(motion('opacity'))
    markerFailure.failOwnershipWrite = true
    const markerBefore = markerFailure.snapshot()
    const markerHost = new MockFigma([markerFailure])

    expect(runFigmaMotionAdapter(markerHost).results[0]).toMatchObject({
      status: 'failed',
      code: 'apply-failed',
      rolledBack: true
    })
    expect(markerHost.rollbackCount).toBe(1)
    expect(markerFailure.snapshot()).toEqual(markerBefore)

    const lyingUndo = new MockMotionNode('6:5')
    lyingUndo.setMotionEnvelope(motion())
    lyingUndo.failField = 'TRANSLATION_X'
    const lyingHost = new MockFigma([lyingUndo], false)

    expect(runFigmaMotionAdapter(lyingHost).results[0]).toMatchObject({
      status: 'failed',
      code: 'apply-failed',
      rolledBack: false
    })
    expect(lyingHost.rollbackCount).toBe(1)
  })

  test('fails closed for foreign property, indexed, and style Motion', () => {
    const property = new MockMotionNode('7:1')
    seedPropertyTrack(property, 'WIDTH')
    property.setMotionEnvelope(motion())
    const propertyBefore = property.snapshot()
    const propertyHost = new MockFigma([property])
    expect(runFigmaMotionAdapter(propertyHost).results[0]).toMatchObject({
      status: 'conflict',
      code: 'foreign-track'
    })
    expect(property.snapshot()).toEqual(propertyBefore)
    expect(propertyHost.commitCount).toBe(0)

    const indexed = new MockMotionNode('7:2')
    ;(indexed.manualKeyframeTracks as { fills?: unknown }).fills = {
      0: {
        id: 'paint:1',
        baseValue: { type: 'FLOAT', value: 0 },
        keyframes: []
      }
    }
    indexed.setMotionEnvelope(motion())
    expect(runFigmaMotionAdapter(new MockFigma([indexed])).results[0]).toMatchObject({
      status: 'conflict',
      code: 'foreign-indexed-track'
    })

    const styled = new MockMotionNode('7:3')
    styled.animationStyles = [{ id: 'style:1' }]
    styled.setMotionEnvelope(motion())
    expect(runFigmaMotionAdapter(new MockFigma([styled])).results[0]).toMatchObject({
      status: 'conflict',
      code: 'foreign-style'
    })
  })

  test('fails closed when Figma edits owned tracks or ownership data', () => {
    const edited = new MockMotionNode('8:1')
    edited.setMotionEnvelope(motion())
    expect(runFigmaMotionAdapter(new MockFigma([edited])).results[0]?.status).toBe('applied')
    const binding = edited.manualKeyframeTracks.OPACITY
    const value = binding?.keyframes[0]?.value
    if (value?.type !== 'FLOAT') throw new Error('missing opacity fixture')
    ;(value as { value: number }).value = 0.5
    const editedBefore = edited.snapshot()
    expect(runFigmaMotionAdapter(new MockFigma([edited])).results[0]).toMatchObject({
      status: 'conflict',
      code: 'native-edited'
    })
    expect(edited.snapshot()).toEqual(editedBefore)

    const forged = new MockMotionNode('8:2')
    forged.setMotionEnvelope(motion())
    expect(runFigmaMotionAdapter(new MockFigma([forged])).results[0]?.status).toBe('applied')
    const raw = forged.getSharedPluginData(
      FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE,
      FIGMA_NATIVE_MOTION_OWNERSHIP_KEY
    )
    const ownership: unknown = JSON.parse(raw)
    if (ownership === null || typeof ownership !== 'object') {
      throw new Error('missing ownership fixture')
    }
    Reflect.set(ownership, 'extra', true)
    forged.setSharedPluginData(
      FIGMA_NATIVE_MOTION_OWNERSHIP_NAMESPACE,
      FIGMA_NATIVE_MOTION_OWNERSHIP_KEY,
      JSON.stringify(ownership)
    )
    expect(runFigmaMotionAdapter(new MockFigma([forged])).results[0]).toMatchObject({
      status: 'conflict',
      code: 'ownership-invalid'
    })
  })
})
