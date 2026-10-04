import { beforeAll, describe, expect, spyOn, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/core/kiwi'
import {
  LOWCODE_APPLICATION_PAGE_PLUGIN_KEY as PAGE_KEY,
  resolveLowcodeApplicationPages
} from '@open-pencil/lowcode'
import { SceneGraph } from '@open-pencil/scene-graph'

import { setApplicationPageGuard } from '@/app/lowcode/application-mode/guards/mutation'

import {
  extractLowcodeAndPluginData,
  serializeLowcodeFields
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

import { expectDefined } from '#tests/helpers/assert'

async function reopen(graph: SceneGraph) {
  return parseFigFile(Uint8Array.from(await exportFigFile(graph)).buffer)
}

describe('application guard FIG persistence', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('atomic guard edits, remapped entry references and original design states survive two saves', async () => {
    const editor = createEditor()
    const graph = editor.graph
    const root = expectDefined(graph.getNode(graph.rootId), 'root')
    const page = graph.getPages()[0]
    graph.updateNode(page.id, { name: 'Business', lowcodeRoutePattern: '/products/:id' })
    const home = graph.addPage('Home')
    for (const node of [page, home]) {
      const entry = graph.createNode('FRAME', node.id, { width: 390, height: 844 })
      node.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: entry.id }
    }
    home.lowcodeRoutePattern = '/home'
    root.lowcodeApplication = { version: 1, enabled: true, startPageId: home.id }
    root.lowcodeDocumentState = [
      { id: 'auth', name: 'isSignedIn', type: 'boolean', defaultValue: false }
    ]
    page.state = [{ id: 'dirty', name: 'dirty', type: 'boolean', defaultValue: false }]
    const enter = { conditionExpr: 'isSignedIn === true', fallback: '/home?from=detail#notice' }
    const leave = { dirtyExpr: 'dirty === true', message: 'Leave without saving?' }
    expect(setApplicationPageGuard(editor, page, 'enter', enter, 'Enter rule')).toBe(true)
    expect(setApplicationPageGuard(editor, page, 'leave', leave, 'Leave rule')).toBe(true)
    editor.undo.undo()
    expect(page.lowcodeApplicationPage?.leaveConfirm).toBeUndefined()
    editor.undo.redo()
    const before = structuredClone([...graph.nodes])
    let current = graph
    for (let cycle = 0; cycle < 2; cycle++) {
      current = await reopen(current)
      const restored = expectDefined(
        current.getPages().find((node) => node.name === 'Business'),
        'page'
      )
      expect(restored.lowcodeApplicationPage).toEqual({
        version: 1,
        role: 'application',
        entryNodeId: restored.childIds[0],
        enterGuard: enter,
        leaveConfirm: leave
      })
      expect(restored.state).toEqual(page.state)
      expect(current.getNode(current.rootId)?.lowcodeDocumentState).toEqual(
        root.lowcodeDocumentState
      )
      expect(resolveLowcodeApplicationPages(current).warnings).toEqual([])
      expect(restored.pluginData.some((item) => item.key === PAGE_KEY)).toBe(false)
    }
    expect([...graph.nodes]).toEqual(before)
  })

  test('absent policy JSON stays byte-identical and never acquires guard fields', async () => {
    const graph = new SceneGraph()
    graph.getPages()[0].lowcodeApplicationPage = { version: 1, role: 'application' }
    const original = '{"version":1,"role":"application"}'
    let current = graph
    for (let cycle = 0; cycle < 2; cycle++) {
      current = await reopen(current)
      const page = current.getPages()[0]
      expect(serializeLowcodeFields(page).find((item) => item.key === PAGE_KEY)?.value).toBe(
        original
      )
      expect(page.lowcodeApplicationPage).toEqual({ version: 1, role: 'application' })
    }
  })

  test('unsupported nested policy remains opaque, unchanged and inactive over two saves', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const value =
        '{"version":1,"role":"application","enterGuard":{"conditionExpr":"true","fallback":"/home","future":true}}'
      const imported = extractLowcodeAndPluginData({
        type: 'CANVAS',
        pluginData: [{ pluginID: 'open-pencil', key: PAGE_KEY, value }]
      })
      expect(imported.lowcodeApplicationPage).toBeUndefined()
      const graph = new SceneGraph()
      graph.getPages()[0].pluginData = imported.pluginData
      let current = graph
      for (let cycle = 0; cycle < 2; cycle++) {
        current = await reopen(current)
        expect(current.getPages()[0].lowcodeApplicationPage).toBeUndefined()
        expect(current.getPages()[0].pluginData).toEqual([
          { pluginId: 'open-pencil', key: PAGE_KEY, value }
        ])
      }
    } finally {
      warn.mockRestore()
    }
  })
})
