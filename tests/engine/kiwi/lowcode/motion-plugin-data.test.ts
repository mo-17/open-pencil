import { beforeAll, describe, expect, spyOn, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'
import { parseFigBuffer } from '@open-pencil/fig'
import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import {
  createMotionPreset,
  type MotionSpec,
  type PluginDataEntry,
  type SceneNode
} from '@open-pencil/scene-graph'

import {
  extractLowcodeAndPluginData,
  LOWCODE_MOTION_KEY,
  serializeLowcodeFields
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

const validMotion = (): MotionSpec =>
  createMotionPreset('slide-up', {
    durationMs: 480,
    delayMs: 40,
    distance: 28
  })

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

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function findNode(graph: SceneGraph, name: string): SceneNode {
  const node = [...graph.getAllNodes()].find((candidate) => candidate.name === name)
  if (!node) throw new Error(`Expected node named ${name}`)
  return node
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
      }
    ])

    const extracted = extractLowcodeAndPluginData({
      pluginData: [motionEntry(entries[0].value)]
    } as Pick<NodeChange, 'pluginData'>)
    expect(extracted.motion).toEqual(motion)
    expect(extracted.motion).not.toBe(motion)
    expect(extracted.pluginData).toEqual([])
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

      const future = motionEntry(JSON.stringify({ version: 2, tracks: [] }))
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
      motion: validMotion(),
      pluginData: [{ pluginId: 'foreign-plugin', key: 'keep', value: 'yes' }]
    })
    const expected = node.motion

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
        '[lowcode] structured motion conflicts with inert raw lowcode/motion; preserving the raw payload and suppressing the structured value'
      )
    } finally {
      warn.mockRestore()
    }
  })
})
