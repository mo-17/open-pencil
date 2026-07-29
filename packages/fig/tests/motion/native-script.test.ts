import { describe, expect, test } from 'bun:test'

import {
  applyFigmaNativeMotionTransaction,
  buildFigmaMotionPluginScript,
  createFigmaNativeMotionApplyRequest,
  createFigmaNativeMotionPlan,
  getFigmaNativeMotionTransactionSource,
  type FigmaNativeMotionEasing,
  type FigmaNativeMotionFieldName,
  type FigmaNativeMotionKeyframe,
  type FigmaNativeMotionOperation,
  type FigmaNativeMotionTransactionResult
} from '@open-pencil/fig'
import type { MotionSpec } from '@open-pencil/scene-graph'

type ScriptResult = FigmaNativeMotionTransactionResult

type StoredKeyframe = FigmaNativeMotionKeyframe & { id: string; easing: FigmaNativeMotionEasing }
type StoredBinding = {
  id: string
  baseValue: { type: 'FLOAT'; value: number }
  keyframes: StoredKeyframe[]
}
type StoredTracks = Partial<Record<FigmaNativeMotionFieldName, StoredBinding>> &
  Record<string, unknown>

interface MockNodeSnapshot {
  animationStyles: Array<{ id: string; styleId: string; name: string }>
  manualKeyframeTracks: StoredTracks
  timelines: Array<{ id: string; duration: number }>
  shared: Array<[string, string]>
}

class MockMotionNode {
  readonly id = '1:2'
  animationStyles: Array<{ id: string; styleId: string; name: string }> = []
  manualKeyframeTracks: StoredTracks = {}
  timelines: Array<{ id: string; duration: number }> = []
  failField?: FigmaNativeMotionFieldName
  corruptField?: FigmaNativeMotionFieldName
  ignoreRemoveField?: FigmaNativeMotionFieldName
  ignoreStyleRemoval = false
  failOwnershipWrite = false
  exposeTimeline = true
  exposeSecondTimeline = false
  timelineDurationAfterApply?: number
  private readonly shared = new Map<string, string>()

  applyManualKeyframeTrack(
    field: FigmaNativeMotionOperation['field'],
    track: FigmaNativeMotionOperation['track']
  ): void {
    if (this.failField === field.name) throw new Error(`apply failed for ${field.name}`)
    const keyframes = track.keyframes.map((frame, index) => ({
      ...structuredClone(frame),
      id: `${field.name}:${index}`,
      easing: structuredClone(frame.easing ?? { type: 'LINEAR' as const })
    }))
    if (this.corruptField === field.name && keyframes[0]) keyframes[0].value.value += 1
    this.manualKeyframeTracks[field.name] = {
      id: `binding:${field.name}`,
      baseValue: structuredClone(track.baseValue),
      keyframes
    }
    if (this.exposeTimeline) {
      const lastPosition = keyframes.at(-1)?.timelinePosition ?? 0.001
      if (!this.timelines[0]) this.timelines = [{ id: 'timeline:1', duration: lastPosition }]
      if (this.timelineDurationAfterApply !== undefined && this.timelines[0]) {
        this.timelines[0].duration = this.timelineDurationAfterApply
      }
      if (this.exposeSecondTimeline && this.timelines.length === 1) {
        this.timelines.push({ id: 'timeline:unexpected', duration: lastPosition })
      }
    }
  }

  removeManualKeyframeTrack(field: FigmaNativeMotionOperation['field']): void {
    if (this.ignoreRemoveField === field.name) return
    Reflect.deleteProperty(this.manualKeyframeTracks, field.name)
  }

  removeAnimationStyle(id: string): void {
    if (this.ignoreStyleRemoval) return
    this.animationStyles = this.animationStyles.filter((style) => style.id !== id)
  }

  setTimelineDuration(id: string, duration: number): void {
    const timeline = this.timelines.find((candidate) => candidate.id === id)
    if (!timeline) throw new Error(`timeline ${id} not found`)
    timeline.duration = duration
  }

  getSharedPluginData(namespace: string, key: string): string {
    return this.shared.get(`${namespace}:${key}`) ?? ''
  }

  setSharedPluginData(namespace: string, key: string, value: string): void {
    if (this.failOwnershipWrite) throw new Error('ownership marker write failed')
    this.shared.set(`${namespace}:${key}`, value)
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
}

class MockFigma {
  readonly currentPage: { selection: MockMotionNode[] }
  commitCount = 0
  rollbackCount = 0
  failLookup = false
  skipUndoRestore = false
  private undoSnapshot?: MockNodeSnapshot

  constructor(readonly node: MockMotionNode) {
    this.currentPage = { selection: [node] }
  }

  async getNodeByIdAsync(id: string): Promise<MockMotionNode | null> {
    if (this.failLookup) throw new Error('lookup rejected')
    return id === this.node.id ? this.node : null
  }

  commitUndo(): void {
    this.commitCount++
    this.undoSnapshot = this.node.snapshot()
  }

  triggerUndo(): void {
    this.rollbackCount++
    if (this.skipUndoRestore) return
    if (!this.undoSnapshot) throw new Error('missing undo snapshot')
    this.node.restore(this.undoSnapshot)
  }
}

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>

function motion(channels: 'opacity' | 'slide' = 'slide', durationMs = 400): MotionSpec {
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

async function runScript(
  spec: MotionSpec,
  node: MockMotionNode,
  options: Parameters<typeof buildFigmaMotionPluginScript>[1] = {}
): Promise<{ figma: MockFigma; result: ScriptResult }> {
  const plan = createFigmaNativeMotionPlan(spec)
  const script = buildFigmaMotionPluginScript(plan, options)
  const figma = new MockFigma(node)
  return { figma, result: await executeScript(script, figma) }
}

async function executeScript(script: string, figma: MockFigma): Promise<ScriptResult> {
  const expression = script.startsWith(';') ? script.slice(1) : script
  const run = new AsyncFunction('figma', `return ${expression}`)
  return (await run(figma)) as ScriptResult
}

function runDirect(
  spec: MotionSpec,
  node: MockMotionNode,
  options: Parameters<typeof createFigmaNativeMotionApplyRequest>[1] = {},
  serialized = false
): { figma: MockFigma; result: FigmaNativeMotionTransactionResult } {
  const request = createFigmaNativeMotionApplyRequest(createFigmaNativeMotionPlan(spec), options)
  const figma = new MockFigma(node)
  const apply = serialized
    ? (new Function(
        `return ${getFigmaNativeMotionTransactionSource()}`
      )() as typeof applyFigmaNativeMotionTransaction)
    : applyFigmaNativeMotionTransaction
  return { figma, result: apply(figma, node, request) }
}

describe('@open-pencil/fig native Motion script transaction', () => {
  test('keeps direct, reconstructed, and generated transaction behavior identical', async () => {
    const assertParity = async (
      configure: (node: MockMotionNode) => void,
      options: Parameters<typeof createFigmaNativeMotionApplyRequest>[1] = {}
    ): Promise<void> => {
      const directNode = new MockMotionNode()
      const reconstructedNode = new MockMotionNode()
      const generatedNode = new MockMotionNode()
      for (const node of [directNode, reconstructedNode, generatedNode]) configure(node)

      const direct = runDirect(motion(), directNode, options)
      const reconstructed = runDirect(motion(), reconstructedNode, options, true)
      const generated = await runScript(motion(), generatedNode, options)

      expect(reconstructed.result).toEqual(direct.result)
      expect(generated.result).toEqual(direct.result)
      expect(reconstructedNode.snapshot()).toEqual(directNode.snapshot())
      expect(generatedNode.snapshot()).toEqual(directNode.snapshot())
      expect(reconstructed.figma.commitCount).toBe(direct.figma.commitCount)
      expect(generated.figma.commitCount).toBe(direct.figma.commitCount)
      expect(reconstructed.figma.rollbackCount).toBe(direct.figma.rollbackCount)
      expect(generated.figma.rollbackCount).toBe(direct.figma.rollbackCount)
    }

    await assertParity(() => undefined)
    await assertParity((node) => {
      node.animationStyles = [{ id: 'style:1', styleId: 'fade', name: 'Fade' }]
    })
    await assertParity(
      (node) => {
        node.animationStyles = [{ id: 'style:1', styleId: 'fade', name: 'Fade' }]
      },
      { conflictPolicy: 'replace-all' }
    )
    await assertParity((node) => {
      node.failOwnershipWrite = true
    })
    expect(buildFigmaMotionPluginScript(createFigmaNativeMotionPlan(motion()))).toContain(
      `const apply = ${getFigmaNativeMotionTransactionSource()}`
    )
  })

  test('rejects a runtime request with extra fields before opening an undo transaction', () => {
    const node = new MockMotionNode()
    const request = {
      ...createFigmaNativeMotionApplyRequest(createFigmaNativeMotionPlan(motion())),
      unexpected: true
    }
    const before = node.snapshot()
    const figma = new MockFigma(node)

    const result = applyFigmaNativeMotionTransaction(figma, node, request)

    expect(result).toMatchObject({
      status: 'failed',
      code: 'adapter-config-invalid',
      preflightFingerprint: null
    })
    expect(figma.commitCount).toBe(0)
    expect(node.snapshot()).toEqual(before)
  })

  test('converts hostile request and capability getters into structured failures', () => {
    const node = new MockMotionNode()
    const figma = new MockFigma(node)
    const request = createFigmaNativeMotionApplyRequest(createFigmaNativeMotionPlan(motion()))
    const hostileRequest = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('request proxy trap')
        }
      }
    )
    const hostileTarget = new Proxy(node, {
      get(target, property, receiver) {
        if (property === 'manualKeyframeTracks') throw new Error('target getter trap')
        return Reflect.get(target, property, receiver)
      }
    })
    const hostileHost = new Proxy(figma, {
      get(target, property, receiver) {
        if (property === 'commitUndo') throw new Error('host getter trap')
        return Reflect.get(target, property, receiver)
      }
    })

    expect(applyFigmaNativeMotionTransaction(figma, node, hostileRequest)).toMatchObject({
      status: 'failed',
      code: 'adapter-config-invalid'
    })
    expect(applyFigmaNativeMotionTransaction(figma, hostileTarget, request)).toMatchObject({
      status: 'failed',
      code: 'motion-api-unavailable'
    })
    expect(applyFigmaNativeMotionTransaction(hostileHost, node, request)).toMatchObject({
      status: 'failed',
      code: 'undo-api-unavailable'
    })
    expect(figma.commitCount).toBe(0)
  })

  test('rejects forged requests outside the bounded Motion runtime', () => {
    const node = new MockMotionNode()
    const request = structuredClone(
      createFigmaNativeMotionApplyRequest(createFigmaNativeMotionPlan(motion()))
    )
    request.ownership.durationSeconds = 1e100
    request.ownership.sourceSignature = JSON.stringify({
      version: 1,
      apiRevision: request.ownership.apiRevision,
      durationSeconds: request.ownership.durationSeconds,
      operations: request.ownership.operations
    })
    const figma = new MockFigma(node)

    expect(applyFigmaNativeMotionTransaction(figma, node, request)).toMatchObject({
      status: 'failed',
      code: 'adapter-config-invalid'
    })
    expect(figma.commitCount).toBe(0)
  })

  test('preserves an explicit selection error for zero or multiple selected nodes', async () => {
    const script = buildFigmaMotionPluginScript(createFigmaNativeMotionPlan(motion()))
    const target = new MockMotionNode()

    for (const selection of [[], [target, new MockMotionNode()]]) {
      const figma = new MockFigma(target)
      figma.currentPage.selection = selection
      const before = target.snapshot()
      const result = await executeScript(script, figma)

      expect(result).toMatchObject({
        status: 'failed',
        code: 'selection',
        message: 'Select exactly one target node before applying Motion'
      })
      expect(figma.commitCount).toBe(0)
      expect(target.snapshot()).toEqual(before)
    }
  })

  test('returns a structured failure when stable node lookup rejects', async () => {
    const node = new MockMotionNode()
    const script = buildFigmaMotionPluginScript(createFigmaNativeMotionPlan(motion()), {
      nodeId: node.id
    })
    const figma = new MockFigma(node)
    figma.failLookup = true

    await expect(executeScript(script, figma)).resolves.toMatchObject({
      status: 'failed',
      code: 'node-lookup-failed',
      message: 'Could not look up the target node: lookup rejected'
    })
    expect(figma.commitCount).toBe(0)
  })

  test('applies once, records ownership, and becomes idempotent', async () => {
    const node = new MockMotionNode()
    const first = await runScript(motion(), node)

    expect(first.result).toMatchObject({
      status: 'applied',
      managedFields: ['OPACITY', 'TRANSLATION_X']
    })
    expect(first.figma.commitCount).toBe(2)
    expect(first.figma.rollbackCount).toBe(0)
    expect(node.getSharedPluginData('openpencil', 'nativeMotionAdapterV1')).not.toBe('')

    const second = await runScript(motion(), node)
    expect(second.result.status).toBe('unchanged')
    expect(second.figma.commitCount).toBe(0)
  })

  test('does not report unchanged when the owned timeline is missing or too short', async () => {
    const node = new MockMotionNode()
    expect((await runScript(motion('opacity'), node)).result.status).toBe('applied')

    node.timelines = []
    const recreated = await runScript(motion('opacity'), node)
    expect(recreated.result.status).toBe('applied')
    expect(node.timelines[0]?.duration).toBe(0.4)

    const [timeline] = node.timelines
    if (!timeline) throw new Error('missing timeline fixture')
    timeline.duration = 0.1
    const blocked = await runScript(motion('opacity'), node)
    expect(blocked.result).toMatchObject({
      status: 'conflict',
      code: 'timeline-growth-required'
    })
    const grown = await runScript(motion('opacity'), node, { allowTimelineGrowth: true })
    expect(grown.result.status).toBe('applied')
    expect(node.timelines[0]?.duration).toBe(0.4)
  })

  test('rejects an ownership record whose signature does not match its operations', async () => {
    const node = new MockMotionNode()
    expect((await runScript(motion('slide'), node)).result.status).toBe('applied')
    const raw = node.getSharedPluginData('openpencil', 'nativeMotionAdapterV1')
    const forged = JSON.parse(raw) as { sourceSignature: string }
    forged.sourceSignature = createFigmaNativeMotionPlan(motion('opacity')).sourceSignature ?? ''
    node.setSharedPluginData('openpencil', 'nativeMotionAdapterV1', JSON.stringify(forged))
    const before = node.snapshot()

    const { figma, result } = await runScript(motion('opacity'), node)
    expect(result).toMatchObject({ status: 'conflict', code: 'ownership-invalid' })
    expect(figma.commitCount).toBe(0)
    expect(node.snapshot()).toEqual(before)
  })

  test('updates only verified owned fields and removes stale owned channels', async () => {
    const node = new MockMotionNode()
    expect((await runScript(motion('slide'), node)).result.status).toBe('applied')
    expect(node.manualKeyframeTracks.TRANSLATION_X).toBeDefined()

    const update = await runScript(motion('opacity'), node)
    expect(update.result.status).toBe('applied')
    expect(node.manualKeyframeTracks.OPACITY).toBeDefined()
    expect(node.manualKeyframeTracks.TRANSLATION_X).toBeUndefined()
  })

  test('rejects foreign styles and tracks without mutation', async () => {
    const styled = new MockMotionNode()
    styled.animationStyles = [{ id: 'style:1', styleId: 'fade', name: 'Fade' }]
    const styleBefore = styled.snapshot()
    const styleResult = await runScript(motion(), styled)
    expect(styleResult.result).toMatchObject({ status: 'conflict', code: 'foreign-style' })
    expect(styled.snapshot()).toEqual(styleBefore)
    expect(styleResult.figma.commitCount).toBe(0)

    const tracked = new MockMotionNode()
    tracked.applyManualKeyframeTrack(
      { type: 'PROPERTY', name: 'ROTATION' },
      {
        baseValue: { type: 'FLOAT', value: 0 },
        keyframes: [
          { timelinePosition: 0, value: { type: 'FLOAT', value: 0 } },
          { timelinePosition: 0.4, value: { type: 'FLOAT', value: 90 } }
        ]
      }
    )
    const trackBefore = tracked.snapshot()
    const trackResult = await runScript(motion(), tracked)
    expect(trackResult.result).toMatchObject({ status: 'conflict', code: 'foreign-track' })
    expect(tracked.snapshot()).toEqual(trackBefore)
  })

  test('detects composite property tracks and only replaces them explicitly', async () => {
    const node = new MockMotionNode()
    node.manualKeyframeTracks.TRANSLATION_XY = {
      id: 'binding:TRANSLATION_XY',
      baseValue: { type: 'FLOAT', value: 0 },
      keyframes: []
    }
    const before = node.snapshot()

    const safe = await runScript(motion('opacity'), node)
    expect(safe.result).toMatchObject({ status: 'conflict', code: 'foreign-track' })
    expect(node.snapshot()).toEqual(before)

    const destructive = await runScript(motion('opacity'), node, {
      conflictPolicy: 'replace-all'
    })
    expect(destructive.result.status).toBe('applied')
    expect(node.manualKeyframeTracks.TRANSLATION_XY).toBeUndefined()
    expect(node.manualKeyframeTracks.OPACITY).toBeDefined()
  })

  test('fails closed for unknown future property tracks even under replace-all', async () => {
    const node = new MockMotionNode()
    node.manualKeyframeTracks.FUTURE_PROPERTY = {
      id: 'binding:future',
      baseValue: { type: 'FLOAT', value: 0 },
      keyframes: []
    }
    const before = node.snapshot()

    const { figma, result } = await runScript(motion('opacity'), node, {
      conflictPolicy: 'replace-all'
    })

    expect(result).toMatchObject({ status: 'conflict', code: 'foreign-unknown-track' })
    expect(figma.commitCount).toBe(0)
    expect(node.snapshot()).toEqual(before)
  })

  test('fails closed for indexed paint tracks under every conflict policy', async () => {
    const node = new MockMotionNode()
    node.manualKeyframeTracks.fills = {
      0: {
        id: 'binding:fill:0',
        baseValue: { type: 'FLOAT', value: 0 },
        keyframes: [{ id: 'fill:0', timelinePosition: 0, value: { type: 'FLOAT', value: 0 } }]
      }
    }
    const before = node.snapshot()

    for (const conflictPolicy of ['replace-owned', 'replace-all'] as const) {
      const { figma, result } = await runScript(motion('opacity'), node, { conflictPolicy })
      expect(result).toMatchObject({ status: 'conflict', code: 'foreign-indexed-track' })
      expect(figma.commitCount).toBe(0)
      expect(node.snapshot()).toEqual(before)
    }
  })

  test('fails closed for non-empty indexed collections with an unknown future shape', async () => {
    const futureShapes: unknown[] = [
      { 0: { future: true } },
      new Map([['0', { future: true }]]),
      Object.defineProperty({}, Symbol('future'), { value: true })
    ]

    for (const futureShape of futureShapes) {
      const node = new MockMotionNode()
      node.manualKeyframeTracks.effects = futureShape
      const before = node.snapshot()
      for (const conflictPolicy of ['replace-owned', 'replace-all'] as const) {
        const { figma, result } = await runScript(motion('opacity'), node, { conflictPolicy })
        expect(result).toMatchObject({ status: 'conflict', code: 'foreign-indexed-track' })
        expect(figma.commitCount).toBe(0)
        expect(node.snapshot()).toEqual(before)
      }
    }
  })

  test('detects native edits to an owned track', async () => {
    const node = new MockMotionNode()
    expect((await runScript(motion(), node)).result.status).toBe('applied')
    const owned = node.manualKeyframeTracks.OPACITY
    if (!owned) throw new Error('missing owned opacity track')
    owned.keyframes[0].value.value = 0.5
    const before = node.snapshot()

    const result = await runScript(motion('opacity'), node)
    expect(result.result).toMatchObject({ status: 'conflict', code: 'native-edited' })
    expect(node.snapshot()).toEqual(before)
  })

  test('rolls back a partial apply failure', async () => {
    const node = new MockMotionNode()
    node.failField = 'TRANSLATION_X'
    const before = node.snapshot()

    const { figma, result } = await runScript(motion(), node)
    expect(result).toMatchObject({ status: 'failed', code: 'apply-failed', rolledBack: true })
    expect(figma.rollbackCount).toBe(1)
    expect(node.snapshot()).toEqual(before)
  })

  test('rolls back when native readback differs', async () => {
    const node = new MockMotionNode()
    node.corruptField = 'OPACITY'
    const before = node.snapshot()

    const { result } = await runScript(motion('opacity'), node)
    expect(result).toMatchObject({ status: 'failed', code: 'apply-failed', rolledBack: true })
    expect(node.snapshot()).toEqual(before)
  })

  test('rolls back timeline growth when the ownership marker write fails', () => {
    const node = new MockMotionNode()
    node.timelines = [{ id: 'timeline:1', duration: 0.1 }]
    node.failOwnershipWrite = true
    const before = node.snapshot()

    const { figma, result } = runDirect(motion('opacity'), node, {
      allowTimelineGrowth: true
    })

    expect(result).toMatchObject({
      status: 'failed',
      code: 'apply-failed',
      rolledBack: true
    })
    expect(result.preflightFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}:\d+$/)
    expect(figma.rollbackCount).toBe(1)
    expect(node.snapshot()).toEqual(before)
    expect(node.timelines[0]?.duration).toBe(0.1)
  })

  test('reports rollback false when undo does not restore the preflight fingerprint', () => {
    const node = new MockMotionNode()
    node.failOwnershipWrite = true
    const before = node.snapshot()
    const request = createFigmaNativeMotionApplyRequest(
      createFigmaNativeMotionPlan(motion('opacity'))
    )
    const figma = new MockFigma(node)
    figma.skipUndoRestore = true

    const result = applyFigmaNativeMotionTransaction(figma, node, request)

    expect(result).toMatchObject({
      status: 'failed',
      code: 'apply-failed',
      rolledBack: false
    })
    expect(result.preflightFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}:\d+$/)
    expect(figma.rollbackCount).toBe(1)
    expect(node.snapshot()).not.toEqual(before)
  })

  test('rolls back when removal silently leaves a stale owned field', async () => {
    const node = new MockMotionNode()
    expect((await runScript(motion('slide'), node)).result.status).toBe('applied')
    node.ignoreRemoveField = 'TRANSLATION_X'
    const before = node.snapshot()

    const { result } = await runScript(motion('opacity'), node)
    expect(result).toMatchObject({ status: 'failed', code: 'apply-failed', rolledBack: true })
    expect(node.snapshot()).toEqual(before)
  })

  test('never shrinks a shared timeline and requires permission to grow one', async () => {
    const longer = new MockMotionNode()
    longer.timelines = [{ id: 'timeline:1', duration: 2 }]
    const longResult = await runScript(motion('opacity'), longer)
    expect(longResult.result.status).toBe('applied')
    expect(longer.timelines[0]?.duration).toBe(2)

    const shorter = new MockMotionNode()
    shorter.timelines = [{ id: 'timeline:1', duration: 0.1 }]
    const blocked = await runScript(motion('opacity'), shorter)
    expect(blocked.result).toMatchObject({
      status: 'conflict',
      code: 'timeline-growth-required'
    })
    expect(shorter.timelines[0]?.duration).toBe(0.1)

    const allowed = await runScript(motion('opacity'), shorter, { allowTimelineGrowth: true })
    expect(allowed.result.status).toBe('applied')
    expect(shorter.timelines[0]?.duration).toBe(0.4)

    const empty = new MockMotionNode()
    empty.timelines = [{ id: 'timeline:empty', duration: 0 }]
    const emptyBlocked = await runScript(motion('opacity'), empty)
    expect(emptyBlocked.result).toMatchObject({
      status: 'conflict',
      code: 'timeline-growth-required'
    })
    const emptyGrown = await runScript(motion('opacity'), empty, { allowTimelineGrowth: true })
    expect(emptyGrown.result.status).toBe('applied')
    expect(empty.timelines[0]?.duration).toBe(0.4)
  })

  test('fails closed for ambiguous timeline readback before or after mutation', async () => {
    const ambiguousBefore = new MockMotionNode()
    ambiguousBefore.timelines = [
      { id: 'timeline:1', duration: 0.4 },
      { id: 'timeline:2', duration: 0.4 }
    ]
    const before = ambiguousBefore.snapshot()
    const rejected = await runScript(motion('opacity'), ambiguousBefore)
    expect(rejected.result).toMatchObject({
      status: 'failed',
      code: 'apply-failed',
      rolledBack: false
    })
    expect(rejected.figma.commitCount).toBe(0)
    expect(ambiguousBefore.snapshot()).toEqual(before)

    const ambiguousAfter = new MockMotionNode()
    ambiguousAfter.exposeSecondTimeline = true
    const empty = ambiguousAfter.snapshot()
    const rolledBack = await runScript(motion('opacity'), ambiguousAfter)
    expect(rolledBack.result).toMatchObject({
      status: 'failed',
      code: 'apply-failed',
      rolledBack: true
    })
    expect(ambiguousAfter.snapshot()).toEqual(empty)
  })

  test('rolls back when Figma expands a newly created timeline beyond the exact expected duration', async () => {
    const node = new MockMotionNode()
    node.timelineDurationAfterApply = 60
    const before = node.snapshot()

    const { result } = await runScript(motion('opacity'), node)
    expect(result).toMatchObject({ status: 'failed', code: 'apply-failed', rolledBack: true })
    expect(node.snapshot()).toEqual(before)
  })

  test('rolls back when Figma does not expose a timeline after apply', async () => {
    const node = new MockMotionNode()
    node.exposeTimeline = false
    const before = node.snapshot()

    const { result } = await runScript(motion('opacity'), node)
    expect(result).toMatchObject({ status: 'failed', rolledBack: true })
    expect(node.snapshot()).toEqual(before)
  })

  test('replace-all is the only policy that removes foreign native Motion', async () => {
    const empty = new MockMotionNode()
    const emptyResult = await runScript(motion('opacity'), empty, {
      conflictPolicy: 'replace-all'
    })
    expect(emptyResult.result).toMatchObject({
      status: 'applied',
      replacedForeignMotion: false
    })

    const node = new MockMotionNode()
    node.animationStyles = [{ id: 'style:1', styleId: 'fade', name: 'Fade' }]
    node.applyManualKeyframeTrack(
      { type: 'PROPERTY', name: 'ROTATION' },
      {
        baseValue: { type: 'FLOAT', value: 0 },
        keyframes: [
          { timelinePosition: 0, value: { type: 'FLOAT', value: 0 } },
          { timelinePosition: 0.4, value: { type: 'FLOAT', value: 90 } }
        ]
      }
    )

    const { result } = await runScript(motion('opacity'), node, {
      conflictPolicy: 'replace-all'
    })
    expect(result).toMatchObject({ status: 'applied', replacedForeignMotion: true })
    expect(node.animationStyles).toEqual([])
    expect(node.manualKeyframeTracks.ROTATION).toBeUndefined()
    expect(node.manualKeyframeTracks.OPACITY).toBeDefined()
  })

  test('rolls back replace-all when an animation style removal is a silent no-op', async () => {
    const node = new MockMotionNode()
    node.animationStyles = [{ id: 'style:1', styleId: 'fade', name: 'Fade' }]
    node.ignoreStyleRemoval = true
    const before = node.snapshot()

    const { result } = await runScript(motion('opacity'), node, {
      conflictPolicy: 'replace-all'
    })
    expect(result).toMatchObject({ status: 'failed', code: 'apply-failed', rolledBack: true })
    expect(node.snapshot()).toEqual(before)
  })
})
