import { beforeAll, describe, expect, spyOn, test } from 'bun:test'

import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/core/kiwi'
import {
  LOWCODE_APPLICATION_PLUGIN_KEY as ROOT_KEY,
  LOWCODE_APPLICATION_PAGE_PLUGIN_KEY as PAGE_KEY,
  resolveLowcodeApplicationPages
} from '@open-pencil/lowcode'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  extractLowcodeAndPluginData,
  serializeLowcodeFields
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

import { expectDefined } from '#tests/helpers/assert'

async function reopen(graph: SceneGraph) {
  return parseFigFile(Uint8Array.from(await exportFigFile(graph)).buffer)
}

describe('application mode FIG persistence', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('legacy fields stay absent and foreign plugin entries stay opaque', () => {
    const graph = new SceneGraph()
    for (const node of [expectDefined(graph.getNode(graph.rootId), 'root'), graph.getPages()[0]])
      expect(
        serializeLowcodeFields(node).some(
          (entry) => entry.key === ROOT_KEY || entry.key === PAGE_KEY
        )
      ).toBe(false)
    const raw = { pluginID: 'foreign', key: ROOT_KEY, value: '{broken' }
    expect(extractLowcodeAndPluginData({ type: 'DOCUMENT', pluginData: [raw] })).toEqual({
      pluginData: [{ pluginId: raw.pluginID, key: raw.key, value: raw.value }]
    })
  })

  test('custom graph IDs, all roles and disabled state survive two real save/reopen cycles', async () => {
    const graph = new SceneGraph()
    const app = graph.createNode('CANVAS', graph.rootId, { id: 'custom-page', name: 'Application' })
    const entry = graph.createNode('FRAME', app.id, {
      id: 'custom-entry',
      name: 'Entry',
      width: 360,
      height: 720
    })
    app.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: entry.id }
    graph.addPage('Reference').lowcodeApplicationPage = { version: 1, role: 'reference' }
    graph.addPage('Components').lowcodeApplicationPage = { version: 1, role: 'components' }
    expectDefined(graph.getNode(graph.rootId), 'root').lowcodeApplication = {
      version: 1,
      enabled: true,
      startPageId: app.id
    }
    const before = structuredClone([...graph.nodes])
    let reopened = await reopen(graph)
    expect([...graph.nodes]).toEqual(before)
    for (let cycle = 0; cycle < 2; cycle++) {
      const page = expectDefined(
        reopened.getPages().find((node) => node.name === 'Application'),
        'node'
      )
      const frame = expectDefined(
        reopened.getChildren(page.id).find((node) => node.name === 'Entry'),
        'node'
      )
      expect(page.id).not.toBe('custom-page')
      expect(frame.id).not.toBe('custom-entry')
      expect(expectDefined(reopened.getNode(reopened.rootId), 'root').lowcodeApplication).toEqual({
        version: 1,
        enabled: true,
        startPageId: page.id
      })
      expect(page.lowcodeApplicationPage).toEqual({
        version: 1,
        role: 'application',
        entryNodeId: frame.id
      })
      expect(
        expectDefined(
          reopened.getPages().find((node) => node.name === 'Reference'),
          'node'
        ).lowcodeApplicationPage
      ).toEqual({ version: 1, role: 'reference' })
      expect(
        expectDefined(
          reopened.getPages().find((node) => node.name === 'Components'),
          'node'
        ).lowcodeApplicationPage
      ).toEqual({ version: 1, role: 'components' })
      expect(resolveLowcodeApplicationPages(reopened).pages).toEqual([
        { pageId: page.id, entryNodeId: frame.id }
      ])
      reopened = await reopen(reopened)
    }
    reopened.updateNode(reopened.rootId, {
      lowcodeApplication: {
        ...expectDefined(
          expectDefined(reopened.getNode(reopened.rootId), 'root').lowcodeApplication,
          'policy'
        ),
        enabled: false
      }
    })
    reopened = await reopen(reopened)
    expect(
      expectDefined(reopened.getNode(reopened.rootId), 'root').lowcodeApplication?.enabled
    ).toBe(false)
    expect(resolveLowcodeApplicationPages(reopened).mode).toBe('legacy')
  })

  test('malformed/future/unknown/duplicate/misplaced contracts remain inert without activating', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      for (const [key, type, values] of [
        [ROOT_KEY, 'DOCUMENT', ['{broken']],
        [ROOT_KEY, 'DOCUMENT', ['{"version":2,"enabled":true}']],
        [PAGE_KEY, 'CANVAS', ['{"version":1,"role":"future"}']],
        [ROOT_KEY, 'CANVAS', ['{"version":1,"enabled":true,"startPageId":"custom-page"}']],
        [PAGE_KEY, 'DOCUMENT', ['{"version":1,"role":"application","entryNodeId":"custom-entry"}']],
        [ROOT_KEY, 'DOCUMENT', ['{"version":1,"enabled":true}', '{"version":1,"enabled":false}']]
      ] as const) {
        const entries = values.map((value) => ({ pluginID: 'open-pencil', key, value }))
        const extracted = extractLowcodeAndPluginData({ type, pluginData: entries })
        expect(extracted.lowcodeApplication).toBeUndefined()
        expect(extracted.lowcodeApplicationPage).toBeUndefined()
        expect(extracted.pluginData).toEqual(
          entries.map(({ pluginID, ...rest }) => ({ pluginId: pluginID, ...rest }))
        )
        const graph = new SceneGraph()
        const owner =
          type === 'DOCUMENT'
            ? expectDefined(graph.getNode(graph.rootId), 'root')
            : graph.getPages()[0]
        owner.pluginData = extracted.pluginData
        const reopened = await reopen(graph)
        const reopenedOwner =
          type === 'DOCUMENT'
            ? expectDefined(reopened.getNode(reopened.rootId), 'root')
            : reopened.getPages()[0]
        expect(reopenedOwner.lowcodeApplication).toBeUndefined()
        expect(reopenedOwner.lowcodeApplicationPage).toBeUndefined()
        expect(reopenedOwner.pluginData).toEqual(extracted.pluginData)
      }
    } finally {
      warn.mockRestore()
    }
  })

  test('inert-key conflict prevents accidental replacement by a native field', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const graph = new SceneGraph()
      const root = expectDefined(graph.getNode(graph.rootId), 'root')
      root.lowcodeApplication = { version: 1, enabled: true }
      root.pluginData = [{ pluginId: 'open-pencil', key: ROOT_KEY, value: '{"version":2}' }]
      expect(serializeLowcodeFields(root).some((entry) => entry.key === ROOT_KEY)).toBe(false)
      const page = graph.getPages()[0]
      page.lowcodeApplicationPage = { version: 1, role: 'reference' }
      page.pluginData = [{ pluginId: 'open-pencil', key: PAGE_KEY, value: '{"version":2}' }]
      expect(serializeLowcodeFields(page).some((entry) => entry.key === PAGE_KEY)).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })
})
