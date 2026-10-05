import { beforeAll, describe, expect, spyOn, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/core/kiwi'
import {
  LOWCODE_APPLICATION_PAGE_PLUGIN_KEY as PAGE_KEY,
  resolveLowcodeApplicationPages
} from '@open-pencil/lowcode'
import { SceneGraph } from '@open-pencil/scene-graph'

import { setApplicationStateRetention } from '@/app/lowcode/application-mode/mutation'

import {
  extractLowcodeAndPluginData,
  serializeLowcodeFields
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

import { expectDefined } from '#tests/helpers/assert'

async function reopen(graph: SceneGraph) {
  return parseFigFile(Uint8Array.from(await exportFigFile(graph)).buffer)
}

describe('application session FIG persistence', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test.each(['reset', 'preserve'] as const)(
    '%s preference, remapped entries and design values survive two real save/read cycles',
    async (stateRetention) => {
      const graph = new SceneGraph()
      const page = graph.createNode('CANVAS', graph.rootId, {
        id: 'custom-business',
        name: 'Business'
      })
      const entry = graph.createNode('FRAME', page.id, {
        id: 'custom-entry',
        name: 'Entry',
        width: 390,
        height: 844
      })
      page.lowcodeApplicationPage = {
        version: 1,
        role: 'application',
        entryNodeId: entry.id,
        stateRetention
      }
      page.lowcodeRoutePattern = '/products/:id'
      page.state = [{ id: 'draft-id', name: 'draft', type: 'string', defaultValue: 'Design draft' }]
      expectDefined(graph.getNode(graph.rootId), 'root').lowcodeApplication = {
        version: 1,
        enabled: true,
        startPageId: page.id
      }
      const before = structuredClone([...graph.nodes])
      let current = graph
      for (let cycle = 0; cycle < 2; cycle++) {
        current = await reopen(current)
        const restored = expectDefined(
          current.getPages().find((node) => node.name === 'Business'),
          'page'
        )
        const restoredEntry = expectDefined(
          current.getChildren(restored.id).find((node) => node.name === 'Entry'),
          'entry'
        )
        expect(restored.id).not.toBe(page.id)
        expect(restored.lowcodeApplicationPage).toEqual({
          version: 1,
          role: 'application',
          entryNodeId: restoredEntry.id,
          stateRetention
        })
        expect(restored.lowcodeRoutePattern).toBe('/products/:id')
        expect(restored.state).toEqual(page.state)
        expect(resolveLowcodeApplicationPages(current).pages).toEqual([
          { pageId: restored.id, entryNodeId: restoredEntry.id, stateRetention }
        ])
        expect(restored.pluginData.some((item) => item.key === PAGE_KEY)).toBe(false)
      }
      expect([...graph.nodes]).toEqual(before)
    }
  )

  test('old policy JSON stays byte-identical and never gains a default field', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    page.lowcodeApplicationPage = { version: 1, role: 'application' }
    const serialized = serializeLowcodeFields(page).find((item) => item.key === PAGE_KEY)
    expect(serialized?.value).toBe('{"version":1,"role":"application"}')
    let current = graph
    for (let cycle = 0; cycle < 2; cycle++) {
      current = await reopen(current)
      const restored = current.getPages()[0]
      expect(restored.lowcodeApplicationPage).toEqual({ version: 1, role: 'application' })
      expect(serializeLowcodeFields(restored).find((item) => item.key === PAGE_KEY)?.value).toBe(
        serialized?.value
      )
    }
  })

  test('an explicit preserve to reset edit survives FIG readback and retains both Web route reset wrappers', async () => {
    const editor = createEditor()
    const graph = editor.graph
    const page = graph.getPages()[0]
    graph.updateNode(page.id, { name: 'Business', lowcodeRoutePattern: '/products/:id' })
    const entry = graph.createNode('FRAME', page.id, { width: 390, height: 844 })
    graph.updateNode(page.id, {
      lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: entry.id },
      state: [{ id: 'draft', name: 'draft', type: 'string', defaultValue: 'Design draft' }]
    })
    const home = graph.addPage('Home')
    const homeEntry = graph.createNode('FRAME', home.id, { width: 390, height: 844 })
    graph.updateNode(home.id, {
      lowcodeRoutePattern: '/home',
      lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: homeEntry.id }
    })
    graph.updateNode(graph.rootId, {
      lowcodeApplication: { version: 1, enabled: true, startPageId: home.id }
    })
    expect(setApplicationStateRetention(editor, page, 'preserve', 'Preserve')).toBe(true)
    expect(setApplicationStateRetention(editor, page, 'reset', 'Reset')).toBe(true)
    expect(page.lowcodeApplicationPage?.stateRetention).toBe('reset')
    editor.undo.undo()
    expect(page.lowcodeApplicationPage?.stateRetention).toBe('preserve')
    editor.undo.redo()
    expect(page.lowcodeApplicationPage?.stateRetention).toBe('reset')

    let current = graph
    for (let cycle = 0; cycle < 2; cycle++) {
      current = await reopen(current)
      const restored = expectDefined(
        current.getPages().find((node) => node.name === 'Business'),
        'business page'
      )
      expect(restored.lowcodeApplicationPage?.stateRetention).toBe('reset')
      expect(restored.state).toEqual(page.state)
      for (const target of ['react', 'vue'] as const) {
        const output = compile({
          graph: current,
          pageIds: current.getPages().map((node) => node.id),
          options: withDefaults({
            target,
            devMode: false,
            router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6'
          })
        })
        expect(output.warnings).toEqual([])
        const app = output.files.get(target === 'react' ? 'src/App.tsx' : 'src/App.vue')
        const routes = target === 'react' ? app : output.files.get('src/router.ts')
        expect(routes).toContain('/products/:id')
        expect(app).toContain(
          target === 'react' ? 'retention="reset"' : "route.fullPath.split('#')[0]"
        )
        expect(output.files.get('src/lib/open-pencil-application-session.ts')).toContain(
          '"retention":"reset"'
        )
        const runtime = output.files.get(
          target === 'react'
            ? 'src/components/_open-pencil-application-session.tsx'
            : 'src/lib/open-pencil-application-session-vue.ts'
        )
        expect(runtime).toContain(
          target === 'react'
            ? 'location.pathname, location.search'
            : "route.fullPath.slice(route.path.length).split('#')[0]"
        )
      }
    }
  })

  test('unsupported retention stays opaque and inactive over two real saves', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const value = '{"version":1,"role":"application","stateRetention":"future"}'
      const extracted = extractLowcodeAndPluginData({
        type: 'CANVAS',
        pluginData: [{ pluginID: 'open-pencil', key: PAGE_KEY, value }]
      })
      expect(extracted.lowcodeApplicationPage).toBeUndefined()
      const graph = new SceneGraph()
      graph.getPages()[0].pluginData = extracted.pluginData
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
