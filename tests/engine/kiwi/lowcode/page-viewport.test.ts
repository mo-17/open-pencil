import { beforeAll, describe, expect, spyOn, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile } from '@open-pencil/core'
import { LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY } from '@open-pencil/lowcode'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  extractLowcodeAndPluginData,
  serializeLowcodeFields
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

import { expectDefined } from '#tests/helpers/assert'

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

describe('page viewport .fig policy persistence', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('leaves legacy pages and unrelated plugin data unchanged', () => {
    const graph = new SceneGraph()
    const page = expectDefined(graph.getPages()[0], 'page')
    expect(
      serializeLowcodeFields(page).some((entry) => entry.key === LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY)
    ).toBe(false)
    expect(
      extractLowcodeAndPluginData({
        pluginData: [{ pluginID: 'other', key: 'viewport', value: 'kept' }]
      })
    ).toEqual({
      pluginData: [{ pluginId: 'other', key: 'viewport', value: 'kept' }]
    })
  })

  test('persists every explicit mode across two actual .fig save/reopen cycles', async () => {
    for (const mode of ['responsive', 'fit-width', 'fixed'] as const) {
      const graph = new SceneGraph()
      const page = expectDefined(graph.getPages()[0], 'page')
      graph.updateNode(page.id, { lowcodePageViewport: { version: 1, mode } })
      graph.createNode('FRAME', page.id, { width: 360, height: 740 })
      const reopened = await parseFigFile(exactBuffer(await exportFigFile(graph)))
      expect(reopened.getPages()[0]?.lowcodePageViewport).toEqual({ version: 1, mode })
      const reopenedAgain = await parseFigFile(exactBuffer(await exportFigFile(reopened)))
      expect(reopenedAgain.getPages()[0]?.lowcodePageViewport).toEqual({ version: 1, mode })
    }
  })

  test('preserves malformed and future policies inert across save/reopen', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      for (const value of [
        '{broken',
        '{"version":2,"mode":"fit-width"}',
        '{"version":1,"mode":"cover"}'
      ]) {
        const raw = { pluginID: 'open-pencil', key: LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY, value }
        const result = extractLowcodeAndPluginData({ pluginData: [raw] })
        expect(result.lowcodePageViewport).toBeUndefined()
        const inert = { pluginId: raw.pluginID, key: raw.key, value }
        expect(result.pluginData).toEqual([inert])
        const graph = new SceneGraph()
        const page = expectDefined(graph.getPages()[0], 'page')
        graph.updateNode(page.id, { pluginData: result.pluginData })
        const reopened = await parseFigFile(exactBuffer(await exportFigFile(graph)))
        expect(reopened.getPages()[0]?.lowcodePageViewport).toBeUndefined()
        expect(reopened.getPages()[0]?.pluginData).toContainEqual(inert)
      }
    } finally {
      warn.mockRestore()
    }
  })

  test('does not overwrite an inert future policy when structured authoring conflicts', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const graph = new SceneGraph()
      const page = expectDefined(graph.getPages()[0], 'page')
      graph.updateNode(page.id, {
        lowcodePageViewport: { version: 1, mode: 'responsive' },
        pluginData: [
          { pluginId: 'open-pencil', key: LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY, value: '{"version":2}' }
        ]
      })
      expect(
        serializeLowcodeFields(page).some((entry) => entry.key === LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY)
      ).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })
})
