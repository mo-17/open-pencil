import { beforeAll, describe, expect, spyOn, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'
import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'

import {
  extractLowcodeAndPluginData,
  LOWCODE_GENERATED_EFFECT_KEY,
  serializeLowcodeFields
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

import { expectDefined } from '#tests/helpers/assert'
import { generatedEffect } from '#tests/helpers/generated-effect'

function makeNode(fields: Partial<SceneNode> = {}): SceneNode {
  return { type: 'RECTANGLE', pluginData: [] as PluginDataEntry[], ...fields } as SceneNode
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

describe('generated-effect .fig pluginData persistence', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('serializes and strictly extracts a canonical isolated layer', () => {
    const spec = generatedEffect('scanlines')
    const entries = serializeLowcodeFields(makeNode({ generatedEffect: spec }))
    expect(entries).toEqual([
      {
        pluginId: OPEN_PENCIL_PLUGIN_ID,
        key: LOWCODE_GENERATED_EFFECT_KEY,
        value: JSON.stringify(spec)
      }
    ])
    const extracted = extractLowcodeAndPluginData({
      pluginData: [
        {
          pluginID: OPEN_PENCIL_PLUGIN_ID,
          key: LOWCODE_GENERATED_EFFECT_KEY,
          value: expectDefined(entries[0], 'serialized plugin data').value
        }
      ]
    } as Pick<NodeChange, 'pluginData'>)
    expect(extracted.generatedEffect).toEqual(spec)
    expect(extracted.generatedEffect).not.toBe(spec)
    expect(extracted.pluginData).toEqual([])
  })

  test('keeps malformed and future layers inert for lossless resave', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      for (const value of ['{not json', JSON.stringify({ ...generatedEffect(), version: 2 })]) {
        const raw = {
          pluginID: OPEN_PENCIL_PLUGIN_ID,
          key: LOWCODE_GENERATED_EFFECT_KEY,
          value
        }
        const extracted = extractLowcodeAndPluginData({ pluginData: [raw] } as Pick<
          NodeChange,
          'pluginData'
        >)
        expect(extracted.generatedEffect).toBeUndefined()
        expect(extracted.pluginData).toEqual([
          { pluginId: raw.pluginID, key: raw.key, value: raw.value }
        ])
      }
    } finally {
      warn.mockRestore()
    }
  })

  test('survives two complete .fig export/import cycles', async () => {
    const graph = new SceneGraph()
    const page = expectDefined(graph.getPages()[0], 'default page')
    const spec = generatedEffect('particles')
    const source = graph.createNode('RECTANGLE', page.id, {
      name: 'Generated effect roundtrip',
      width: 160,
      height: 100,
      generatedEffect: spec
    })

    const first = await parseFigFile(exactBuffer(await exportFigFile(graph)))
    const firstNode = [...first.getAllNodes()].find((node) => node.name === source.name)
    expect(firstNode?.generatedEffect).toEqual(spec)
    expect(firstNode?.generatedEffect).not.toBe(spec)

    const second = await parseFigFile(exactBuffer(await exportFigFile(first)))
    const secondNode = [...second.getAllNodes()].find((node) => node.name === source.name)
    expect(secondNode?.generatedEffect).toEqual(spec)
  })
})
