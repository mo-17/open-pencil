import { beforeAll, describe, expect, test } from 'bun:test'

import { uint8ArrayToArrayBuffer } from '#core-tests/helpers/fig/fixtures'

import { exportFigFile, initCodec, parseFigFile } from '@open-pencil/core'
import { parseFigBuffer } from '@open-pencil/fig'
import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import { SceneGraph } from '@open-pencil/scene-graph'

import { LOWCODE_STATE_KEY } from '#core/kiwi/fig/node-change/lowcode-plugin-data'

const opaqueEntry = { pluginId: 'future-plugin', key: 'page-policy', value: '{"version":9}' }
const futureEntry = {
  pluginId: OPEN_PENCIL_PLUGIN_ID,
  key: 'lowcode/future-page-setting',
  value: '{"version":9,"opaque":true}'
}
const pageState = [{ id: 'page_value', name: 'value', type: 'number' as const, defaultValue: 3 }]

async function roundtrip(graph: SceneGraph): Promise<SceneGraph> {
  return parseFigFile(uint8ArrayToArrayBuffer(await exportFigFile(graph)))
}

describe('page plugin data in .fig records', () => {
  beforeAll(initCodec)

  test('retains page state and opaque entries over two saves', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: pageState,
      pluginData: [opaqueEntry, futureEntry],
      lowcodeRoutePattern: '/products/:id'
    })
    let current = graph
    for (let generation = 0; generation < 2; generation++) {
      current = await roundtrip(current)
      const reopened = current.getPages()[0]
      expect(reopened.state).toEqual(pageState)
      expect(reopened.lowcodeRoutePattern).toBe('/products/:id')
      expect(reopened.pluginData).toEqual([opaqueEntry, futureEntry])
    }
  })

  test('patch saves update and clear absorbed state without reviving raw plugin data', async () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.getPages()[0].id, {
      state: pageState,
      pluginData: [opaqueEntry, futureEntry]
    })
    const reopened = await roundtrip(graph)
    const page = reopened.getPages()[0]
    reopened.updateNode(page.id, {
      state: [{ ...pageState[0], defaultValue: 8 }],
      pluginData: [{ ...opaqueEntry, value: '{"version":10}' }, futureEntry]
    })
    const edited = await roundtrip(reopened)
    const editedPage = edited.getPages()[0]
    expect(editedPage.state?.[0]?.defaultValue).toBe(8)
    expect(editedPage.pluginData[0]?.value).toBe('{"version":10}')

    edited.updateNode(editedPage.id, { state: [], pluginData: [futureEntry] })
    const bytes = await exportFigFile(edited)
    const canvas = parseFigBuffer(uint8ArrayToArrayBuffer(bytes)).nodeChanges.find(
      (change) => change.type === 'CANVAS'
    )
    expect(canvas?.pluginData?.some((entry) => entry.key === LOWCODE_STATE_KEY)).toBe(false)
    const cleared = await parseFigFile(uint8ArrayToArrayBuffer(bytes))
    expect(cleared.getPages()[0].state ?? []).toEqual([])
    expect(cleared.getPages()[0].pluginData).toEqual([futureEntry])
  })
})
