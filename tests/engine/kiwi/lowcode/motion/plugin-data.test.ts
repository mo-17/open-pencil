import { beforeAll, describe, expect, spyOn, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'
import {
  decodeFigmaMotionSharedEnvelope,
  decodeFigmaMotionSharedPayload,
  encodeFigmaMotionSharedEnvelope,
  FIGMA_MOTION_SHARED_KEY,
  FIGMA_MOTION_SHARED_NAMESPACE,
  parseFigBuffer
} from '@open-pencil/fig'
import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import {
  createMotionPreset,
  type MotionSceneSpec,
  type MotionSpec,
  type PluginDataEntry,
  type SceneNode
} from '@open-pencil/scene-graph'

import {
  extractLowcodeAndPluginData,
  LOWCODE_MOTION_KEY,
  LOWCODE_MOTION_SCENE_KEY,
  LOWCODE_MOTION_SHARED_CONFLICT_KEY,
  serializeLowcodeFields
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

import { advancedMotionSpec } from '#tests/helpers/motion-v3-advanced'

const validMotion = (): MotionSpec =>
  createMotionPreset('slide-up', {
    durationMs: 480,
    delayMs: 40,
    distance: 28
  })

const validMotionScene = (targetNodeId = '0:10'): MotionSceneSpec => ({
  version: 1,
  id: 'pageScene',
  sequences: [
    {
      id: 'intro',
      trigger: 'pageEnter',
      cues: [
        {
          id: 'heroCue',
          targetNodeId,
          trackId: 'entrance',
          startMs: 120
        }
      ]
    }
  ]
})

const userPresetMotion = (): MotionSpec => {
  const motion = validMotion()
  motion.version = 2
  motion.preset = { id: 'user-card-enter', version: 3, parameters: {} }
  motion.tracks[0].path = {
    points: [
      { x: 0, y: 0 },
      { x: 80, y: 20 }
    ],
    autoRotate: true
  }
  motion.tracks[0].timing.easing = {
    type: 'elastic',
    mode: 'inOut',
    amplitude: 1.5,
    period: 0.4
  }
  for (const frame of motion.tracks[0].keyframes) {
    frame.width = 120 + frame.offset * 40
    frame.fillColor = { r: 1 - frame.offset, g: 0.25, b: frame.offset, a: 1 }
    frame.pathProgress = frame.offset
  }
  motion.tracks[0].keyframes[0].easing = {
    type: 'back',
    mode: 'out',
    overshoot: 2.2
  }
  return motion
}

function makeNode(fields: Partial<SceneNode> = {}): SceneNode {
  return {
    type: 'RECTANGLE',
    pluginData: [] as PluginDataEntry[],
    ...fields
  } as SceneNode
}

function motionEntry(value: string) {
  return { pluginID: OPEN_PENCIL_PLUGIN_ID, key: LOWCODE_MOTION_KEY, value }
}

function motionSceneEntry(value: string) {
  return { pluginID: OPEN_PENCIL_PLUGIN_ID, key: LOWCODE_MOTION_SCENE_KEY, value }
}

function sharedMotionEntry(value: string) {
  return {
    pluginID: FIGMA_MOTION_SHARED_NAMESPACE,
    key: `${FIGMA_MOTION_SHARED_NAMESPACE}/${FIGMA_MOTION_SHARED_KEY}`,
    value
  }
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function findNode(graph: SceneGraph, name: string): SceneNode {
  const node = [...graph.getAllNodes()].find((candidate) => candidate.name === name)
  if (!node) throw new Error(`Expected node named ${name}`)
  return node
}

function archivedSharedValues(entries: PluginDataEntry[]): string[] {
  return entries
    .filter(
      (entry) =>
        entry.pluginId === OPEN_PENCIL_PLUGIN_ID && entry.key === LOWCODE_MOTION_SHARED_CONFLICT_KEY
    )
    .map((entry) => (JSON.parse(entry.value) as { value: string }).value)
}

describe('MotionSpec pluginData persistence', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('omits lowcode/motion when a node has no motion', () => {
    expect(serializeLowcodeFields(makeNode())).toEqual([])
  })

  test('serializes and strictly extracts a valid MotionSpec', () => {
    const motion = validMotion()
    const entries = serializeLowcodeFields(makeNode({ motion }))
    expect(entries).toEqual([
      {
        pluginId: OPEN_PENCIL_PLUGIN_ID,
        key: LOWCODE_MOTION_KEY,
        value: JSON.stringify(motion)
      },
      {
        pluginId: FIGMA_MOTION_SHARED_NAMESPACE,
        key: `${FIGMA_MOTION_SHARED_NAMESPACE}/${FIGMA_MOTION_SHARED_KEY}`,
        value: encodeFigmaMotionSharedEnvelope(motion)
      }
    ])

    const extracted = extractLowcodeAndPluginData({
      pluginData: [motionEntry(entries[0].value)]
    } as Pick<NodeChange, 'pluginData'>)
    expect(extracted.motion).toEqual(motion)
    expect(extracted.motion).not.toBe(motion)
    expect(extracted.pluginData).toEqual([])
  })

  test('serializes and strictly extracts a valid MotionSceneSpec independently', () => {
    const motionScene = validMotionScene()
    const entries = serializeLowcodeFields(makeNode({ motionScene }))
    expect(entries).toEqual([
      {
        pluginId: OPEN_PENCIL_PLUGIN_ID,
        key: LOWCODE_MOTION_SCENE_KEY,
        value: JSON.stringify(motionScene)
      }
    ])

    const extracted = extractLowcodeAndPluginData({
      pluginData: [motionSceneEntry(entries[0].value)]
    } as Pick<NodeChange, 'pluginData'>)
    expect(extracted.motionScene).toEqual(motionScene)
    expect(extracted.motionScene).not.toBe(motionScene)
    expect(extracted.pluginData).toEqual([])
  })

  test('keeps malformed scenes inert without blocking an independent shared Motion mirror', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const motion = validMotion()
      const malformedScene = motionSceneEntry('{not json')
      const extracted = extractLowcodeAndPluginData({
        pluginData: [malformedScene, sharedMotionEntry(encodeFigmaMotionSharedEnvelope(motion))]
      } as Pick<NodeChange, 'pluginData'>)

      expect(extracted.motion).toEqual(motion)
      expect(extracted.motionScene).toBeUndefined()
      expect(extracted.pluginData).toContainEqual({
        pluginId: malformedScene.pluginID,
        key: malformedScene.key,
        value: malformedScene.value
      })
    } finally {
      warn.mockRestore()
    }
  })

  test('imports a strict shared Motion mirror when private canonical data is absent', () => {
    const motion = validMotion()
    const extracted = extractLowcodeAndPluginData({
      pluginData: [sharedMotionEntry(encodeFigmaMotionSharedEnvelope(motion))]
    } as Pick<NodeChange, 'pluginData'>)

    expect(extracted.motion).toEqual(motion)
    expect(extracted.pluginData).toEqual([])
  })

  test('removes a matching shared mirror and preserves conflicting mirrors inertly', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const motion = validMotion()
      const matching = extractLowcodeAndPluginData({
        pluginData: [
          motionEntry(JSON.stringify(motion)),
          sharedMotionEntry(encodeFigmaMotionSharedEnvelope(motion))
        ]
      } as Pick<NodeChange, 'pluginData'>)
      expect(matching.motion).toEqual(motion)
      expect(matching.pluginData).toEqual([])

      const other = validMotion()
      other.tracks[0].timing.durationMs += 1
      const shared = sharedMotionEntry(encodeFigmaMotionSharedEnvelope(other))
      const conflicting = extractLowcodeAndPluginData({
        pluginData: [motionEntry(JSON.stringify(motion)), shared]
      } as Pick<NodeChange, 'pluginData'>)
      expect(conflicting.motion).toEqual(motion)
      expect(archivedSharedValues(conflicting.pluginData)).toContain(shared.value)
    } finally {
      warn.mockRestore()
    }
  })

  test('keeps the private canonical MotionSpec when an inert shared mirror conflicts', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const canonical = validMotion()
      const conflicting = validMotion()
      conflicting.tracks[0].timing.durationMs += 1
      const rawShared: PluginDataEntry = {
        pluginId: FIGMA_MOTION_SHARED_NAMESPACE,
        key: `${FIGMA_MOTION_SHARED_NAMESPACE}/${FIGMA_MOTION_SHARED_KEY}`,
        value: encodeFigmaMotionSharedEnvelope(conflicting)
      }
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      const node = graph.createNode('RECTANGLE', page.id, {
        name: 'Conflicting shared motion mirror',
        motion: canonical,
        pluginData: [rawShared]
      })

      const firstBytes = await exportFigFile(graph)
      const raw = parseFigBuffer(exactBuffer(firstBytes))
      const exported = raw.nodeChanges.find((candidate) => candidate.name === node.name)
      const activeShared = (exported?.pluginData ?? []).filter(
        (entry) =>
          entry.pluginID === FIGMA_MOTION_SHARED_NAMESPACE &&
          entry.key === `${FIGMA_MOTION_SHARED_NAMESPACE}/${FIGMA_MOTION_SHARED_KEY}`
      )
      expect(activeShared).toHaveLength(1)
      expect(decodeFigmaMotionSharedEnvelope(activeShared[0].value)).toEqual({
        ok: true,
        value: { schema: 'openpencil.motion', version: 1, motion: canonical }
      })
      const first = await parseFigFile(exactBuffer(firstBytes))
      const firstNode = findNode(first, node.name)
      expect(firstNode.motion).toEqual(canonical)
      expect(archivedSharedValues(firstNode.pluginData)).toContain(rawShared.value)

      const second = await parseFigFile(exactBuffer(await exportFigFile(first)))
      const secondNode = findNode(second, node.name)
      expect(secondNode.motion).toEqual(canonical)
      expect(archivedSharedValues(secondNode.pluginData)).toContain(rawShared.value)
      expect(warn).toHaveBeenCalledWith(
        '[lowcode] structured motion conflicts with an active shared mirror; archiving the raw payload and replacing the active mirror with the private canonical value'
      )
    } finally {
      warn.mockRestore()
    }
  })

  test('does not resurrect a conflicting shared mirror after Motion is explicitly cleared', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const canonical = validMotion()
      const conflicting = validMotion()
      conflicting.tracks[0].timing.durationMs += 320
      const rawShared: PluginDataEntry = {
        pluginId: FIGMA_MOTION_SHARED_NAMESPACE,
        key: `${FIGMA_MOTION_SHARED_NAMESPACE}/${FIGMA_MOTION_SHARED_KEY}`,
        value: encodeFigmaMotionSharedEnvelope(conflicting)
      }
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      const source = graph.createNode('RECTANGLE', page.id, {
        name: 'Cleared shared conflict',
        motion: canonical,
        pluginData: [rawShared]
      })

      graph.clearNodeFields(source.id, ['motion'])
      const clearedBytes = await exportFigFile(graph)
      const decoded = parseFigBuffer(exactBuffer(clearedBytes))
      const exported = decoded.nodeChanges.find((candidate) => candidate.name === source.name)
      const activeShared = (exported?.pluginData ?? []).filter(
        (entry) =>
          entry.pluginID === FIGMA_MOTION_SHARED_NAMESPACE &&
          entry.key === `${FIGMA_MOTION_SHARED_NAMESPACE}/${FIGMA_MOTION_SHARED_KEY}`
      )
      expect(activeShared).toHaveLength(1)
      expect(decodeFigmaMotionSharedPayload(activeShared[0].value)).toEqual({
        ok: true,
        value: {
          kind: 'cleared',
          value: { schema: 'openpencil.motion', version: 1, cleared: true }
        }
      })

      const reopened = await parseFigFile(exactBuffer(clearedBytes))
      const reopenedNode = findNode(reopened, source.name)
      expect(reopenedNode.motion).toBeUndefined()
      expect(archivedSharedValues(reopenedNode.pluginData)).toContain(rawShared.value)

      const resavedBytes = await exportFigFile(reopened)
      const resavedRaw = parseFigBuffer(exactBuffer(resavedBytes))
      const resaved = resavedRaw.nodeChanges.find((candidate) => candidate.name === source.name)
      expect(
        (resaved?.pluginData ?? []).some(
          (entry) =>
            entry.pluginID === FIGMA_MOTION_SHARED_NAMESPACE &&
            entry.key === `${FIGMA_MOTION_SHARED_NAMESPACE}/${FIGMA_MOTION_SHARED_KEY}`
        )
      ).toBe(false)
      const reopenedAgain = await parseFigFile(exactBuffer(resavedBytes))
      expect(findNode(reopenedAgain, source.name).motion).toBeUndefined()
    } finally {
      warn.mockRestore()
    }
  })

  test('preserves malformed and future-version motion entries as inert pluginData', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const malformed = motionEntry('{not json')
      const malformedResult = extractLowcodeAndPluginData({
        pluginData: [malformed]
      } as Pick<NodeChange, 'pluginData'>)
      expect(malformedResult.motion).toBeUndefined()
      expect(malformedResult.pluginData).toEqual([
        { pluginId: malformed.pluginID, key: malformed.key, value: malformed.value }
      ])

      const future = motionEntry(JSON.stringify({ version: 99, tracks: [] }))
      const futureResult = extractLowcodeAndPluginData({
        pluginData: [future]
      } as Pick<NodeChange, 'pluginData'>)
      expect(futureResult.motion).toBeUndefined()
      expect(futureResult.pluginData).toEqual([
        { pluginId: future.pluginID, key: future.key, value: future.value }
      ])
    } finally {
      warn.mockRestore()
    }
  })

  test('keeps foreign pluginData beside a structured motion entry', () => {
    const motion = validMotion()
    const foreign = { pluginID: 'foreign-plugin', key: 'animation-hint', value: 'keep-me' }
    const extracted = extractLowcodeAndPluginData({
      pluginData: [foreign, motionEntry(JSON.stringify(motion))]
    } as Pick<NodeChange, 'pluginData'>)

    expect(extracted.motion).toEqual(motion)
    expect(extracted.pluginData).toEqual([
      { pluginId: foreign.pluginID, key: foreign.key, value: foreign.value }
    ])
  })

  test('preserves valid motion and foreign data through G0 to G1 to G2', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('RECTANGLE', page.id, {
      name: 'Motion roundtrip node',
      width: 120,
      height: 80,
      motion: userPresetMotion(),
      pluginData: [{ pluginId: 'foreign-plugin', key: 'keep', value: 'yes' }]
    })
    const expected = node.motion
    expect(expected?.preset).toEqual({ id: 'user-card-enter', version: 3, parameters: {} })

    const g1 = await parseFigFile(exactBuffer(await exportFigFile(graph)))
    const g1Node = findNode(g1, node.name)
    expect(g1Node.motion).toEqual(expected)
    expect(g1Node.pluginData).toContainEqual({
      pluginId: 'foreign-plugin',
      key: 'keep',
      value: 'yes'
    })

    const g2 = await parseFigFile(exactBuffer(await exportFigFile(g1)))
    const g2Node = findNode(g2, node.name)
    expect(g2Node.motion).toEqual(expected)
    expect(g2Node.motion).toEqual(g1Node.motion)
    expect(g2Node.pluginData).toContainEqual({
      pluginId: 'foreign-plugin',
      key: 'keep',
      value: 'yes'
    })
  })

  test('preserves every MotionSpec v3 structured channel through G0 to G1 to G2', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const expected = advancedMotionSpec()
    const node = graph.createNode('RECTANGLE', page.id, {
      name: 'Structured Motion roundtrip node',
      width: 120,
      height: 80,
      motion: expected
    })

    const g1 = await parseFigFile(exactBuffer(await exportFigFile(graph)))
    const g1Node = findNode(g1, node.name)
    expect(g1Node.motion).toEqual(expected)
    expect(g1Node.motion).not.toBe(expected)

    const g2 = await parseFigFile(exactBuffer(await exportFigFile(g1)))
    const g2Node = findNode(g2, node.name)
    expect(g2Node.motion).toEqual(expected)
    expect(g2Node.motion).toEqual(g1Node.motion)
  })

  test('preserves scene choreography through G0 to G1 to G2', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const target = graph.createNode('RECTANGLE', page.id, {
      name: 'Scene target',
      motion: validMotion()
    })
    const owner = graph.createNode('FRAME', page.id, {
      name: 'Scene choreography owner',
      motionScene: validMotionScene(target.id)
    })
    const g1 = await parseFigFile(exactBuffer(await exportFigFile(graph)))
    const g1Owner = findNode(g1, owner.name)
    const g1Target = findNode(g1, target.name)
    expect(g1Owner.motionScene).toEqual(validMotionScene(g1Target.id))
    expect(g1Owner.source.editedFields).toEqual([])

    const g2 = await parseFigFile(exactBuffer(await exportFigFile(g1)))
    const g2Owner = findNode(g2, owner.name)
    const g2Target = findNode(g2, target.name)
    expect(g2Owner.motionScene).toEqual(validMotionScene(g2Target.id))
    expect(g2Owner.source.editedFields).toEqual([])
  })

  test('preserves malformed and future scene choreography inertly across ordinary saves', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const future: PluginDataEntry = {
      pluginId: OPEN_PENCIL_PLUGIN_ID,
      key: LOWCODE_MOTION_SCENE_KEY,
      value: JSON.stringify({ version: 2, id: 'futureScene', sequences: [] })
    }
    const node = graph.createNode('FRAME', page.id, {
      name: 'Future scene choreography',
      pluginData: [future]
    })

    const g1 = await parseFigFile(exactBuffer(await exportFigFile(graph)))
    const g1Node = findNode(g1, node.name)
    expect(g1Node.motionScene).toBeUndefined()
    expect(g1Node.pluginData).toContainEqual(future)

    const g2 = await parseFigFile(exactBuffer(await exportFigFile(g1)))
    const g2Node = findNode(g2, node.name)
    expect(g2Node.motionScene).toBeUndefined()
    expect(g2Node.pluginData).toContainEqual(future)
  })

  test('exports exactly one Figma-readable shared Motion mirror', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const motion = userPresetMotion()
    const node = graph.createNode('RECTANGLE', page.id, {
      name: 'Shared Motion mirror',
      width: 120,
      height: 80,
      motion
    })

    const bytes = await exportFigFile(graph)
    const decoded = parseFigBuffer(exactBuffer(bytes))
    const exported = decoded.nodeChanges.find((candidate) => candidate.name === node.name)
    const shared = (exported?.pluginData ?? []).filter(
      (entry) =>
        entry.pluginID === FIGMA_MOTION_SHARED_NAMESPACE &&
        entry.key === `${FIGMA_MOTION_SHARED_NAMESPACE}/${FIGMA_MOTION_SHARED_KEY}`
    )

    expect(shared).toHaveLength(1)
    expect(decodeFigmaMotionSharedEnvelope(shared[0].value)).toEqual({
      ok: true,
      value: { schema: 'openpencil.motion', version: 1, motion }
    })
  })

  test('ordinary save keeps malformed motion pluginData without executing it', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const malformed: PluginDataEntry = {
      pluginId: OPEN_PENCIL_PLUGIN_ID,
      key: LOWCODE_MOTION_KEY,
      value: JSON.stringify({ version: 99, tracks: [] })
    }
    const node = graph.createNode('RECTANGLE', page.id, {
      name: 'Future motion node',
      width: 120,
      height: 80,
      pluginData: [malformed]
    })

    const g1 = await parseFigFile(exactBuffer(await exportFigFile(graph)))
    const g1Node = findNode(g1, node.name)
    expect(g1Node.motion).toBeUndefined()
    expect(g1Node.pluginData).toContainEqual(malformed)

    const g2 = await parseFigFile(exactBuffer(await exportFigFile(g1)))
    const g2Node = findNode(g2, node.name)
    expect(g2Node.motion).toBeUndefined()
    expect(g2Node.pluginData).toContainEqual(malformed)
  })

  test('DOCUMENT and CANVAS preserve inert motion pluginData without structured lowcode', async () => {
    const graph = new SceneGraph()
    const root = graph.getNode(graph.rootId)
    const page = graph.getPages()[0]
    if (!root) throw new Error('Expected document root')

    const documentMalformed: PluginDataEntry = {
      pluginId: OPEN_PENCIL_PLUGIN_ID,
      key: LOWCODE_MOTION_KEY,
      value: JSON.stringify({ version: 1, tracks: 'malformed' })
    }
    const canvasFuture: PluginDataEntry = {
      pluginId: OPEN_PENCIL_PLUGIN_ID,
      key: LOWCODE_MOTION_KEY,
      value: JSON.stringify({ version: 99, tracks: [], scope: 'canvas' })
    }
    root.pluginData = [documentMalformed]
    page.pluginData = [canvasFuture]

    const g1 = await parseFigFile(exactBuffer(await exportFigFile(graph)))
    const g1Root = g1.getNode(g1.rootId)
    const g1Page = g1.getPages()[0]
    expect(g1Root?.motion).toBeUndefined()
    expect(g1Root?.pluginData).toEqual([documentMalformed])
    expect(g1Page.motion).toBeUndefined()
    expect(g1Page.pluginData).toEqual([canvasFuture])

    const g2 = await parseFigFile(exactBuffer(await exportFigFile(g1)))
    const g2Root = g2.getNode(g2.rootId)
    const g2Page = g2.getPages()[0]
    expect(g2Root?.motion).toBeUndefined()
    expect(g2Root?.pluginData).toEqual([documentMalformed])
    expect(g2Page.motion).toBeUndefined()
    expect(g2Page.pluginData).toEqual([canvasFuture])
  })

  test('inert raw motion wins deterministically over conflicting structured motion', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      const future: PluginDataEntry = {
        pluginId: OPEN_PENCIL_PLUGIN_ID,
        key: LOWCODE_MOTION_KEY,
        value: JSON.stringify({ version: 99, tracks: [] })
      }
      const node = graph.createNode('RECTANGLE', page.id, {
        name: 'Conflicting motion node',
        width: 120,
        height: 80,
        motion: validMotion(),
        pluginData: [future]
      })

      const bytes = await exportFigFile(graph)
      const decoded = parseFigBuffer(exactBuffer(bytes))
      const exported = decoded.nodeChanges.find((candidate) => candidate.name === node.name)
      const canonicalMotionEntries = (exported?.pluginData ?? []).filter(
        (entry) => entry.pluginID === OPEN_PENCIL_PLUGIN_ID && entry.key === LOWCODE_MOTION_KEY
      )
      expect(canonicalMotionEntries).toEqual([
        {
          pluginID: future.pluginId,
          key: future.key,
          value: future.value
        }
      ])

      const imported = await parseFigFile(exactBuffer(bytes))
      const importedNode = findNode(imported, node.name)
      expect(importedNode.motion).toBeUndefined()
      expect(importedNode.pluginData).toContainEqual(future)
      expect(warn).toHaveBeenCalledWith(
        '[lowcode] structured motion conflicts with inert private motion data; preserving the raw payload and suppressing the structured value'
      )
    } finally {
      warn.mockRestore()
    }
  })
})
