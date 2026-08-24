import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import {
  MAP_MODULE_TYPE,
  MAP_PLUGIN_ID,
  createMapModuleFrameOverrides,
  resolveMapModule
} from '@open-pencil/core/plugins'

import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createAutomationToolHandler } from '@/app/automation/bridge/tool-handlers'
import { createEditorStore } from '@/app/editor/session'

function setup(canCreateModule: (pluginId: string, moduleType: string) => boolean = () => true) {
  const store = createEditorStore()
  const page = store.graph.getNode(store.state.currentPageId)
  if (!page) throw new Error('Expected current page')
  store.flashNodes = () => undefined
  const target: AutomationTarget = {
    store,
    documentId: 'module-automation-test',
    documentName: 'Module automation test',
    pageId: page.id,
    pageName: page.name
  }
  const handle = createAutomationToolHandler(
    (currentStore) => new FigmaAPI(currentStore.graph),
    canCreateModule
  )
  return { handle, page, store, target }
}

function resultNodeId(response: unknown): string {
  const id = (response as { result?: { data?: { id?: unknown } } }).result?.data?.id
  if (typeof id !== 'string') throw new Error('Expected module tool result node id')
  return id
}

describe('automation module tool handler', () => {
  test('creates a module through editor history and preserves it across undo and redo', async () => {
    const { handle, store, target } = setup()

    const response = await handle(target, {
      name: 'create_module',
      args: {
        plugin_id: MAP_PLUGIN_ID,
        module_type: MAP_MODULE_TYPE,
        x: 24,
        y: 32,
        width: 480,
        height: 300,
        name: 'Automation Map',
        config: { center: [116.4074, 39.9042], zoom: 10 }
      }
    })
    const id = resultNodeId(response)

    expect(response).toMatchObject({
      ok: true,
      result: { ok: true, data: { id, name: 'Automation Map', type: 'FRAME' } },
      meta: { targetPageId: target.pageId, mutatedIds: [id] }
    })
    expect(store.graph.getNode(id)).toMatchObject({
      type: 'FRAME',
      name: 'Automation Map',
      x: 24,
      y: 32,
      width: 480,
      height: 300
    })
    expect(resolveMapModule(store.graph.getNode(id)?.interactiveProps?.module)).toMatchObject({
      ok: true,
      config: { center: [116.4074, 39.9042], zoom: 10 }
    })
    expect(store.undo.undoLabel).toBe('AI: create_module')

    store.undo.undo()
    expect(store.graph.getNode(id)).toBeUndefined()

    store.undo.redo()
    expect(store.graph.getNode(id)).toMatchObject({
      name: 'Automation Map',
      x: 24,
      y: 32,
      width: 480,
      height: 300
    })
    expect(resolveMapModule(store.graph.getNode(id)?.interactiveProps?.module)).toMatchObject({
      ok: true,
      config: { zoom: 10 }
    })
  })

  test('updates a module through editor history and restores the previous config on undo', async () => {
    const { handle, page, store, target } = setup()
    const node = store.graph.createNode(
      'FRAME',
      page.id,
      createMapModuleFrameOverrides({ center: [1, 2], zoom: 4 })
    )
    store.undo.clear()

    const response = await handle(target, {
      name: 'update_module',
      args: {
        id: node.id,
        plugin_id: MAP_PLUGIN_ID,
        module_type: MAP_MODULE_TYPE,
        config: { zoom: 9, style: 'dark' }
      }
    })

    expect(response).toMatchObject({
      ok: true,
      result: { ok: true, data: { id: node.id, config: { zoom: 9, style: 'dark' } } },
      meta: { targetPageId: target.pageId, mutatedIds: [node.id] }
    })
    expect(resolveMapModule(store.graph.getNode(node.id)?.interactiveProps?.module)).toMatchObject({
      ok: true,
      config: { center: [1, 2], zoom: 9, style: 'dark' }
    })
    expect(store.undo.undoLabel).toBe('AI: update_module')

    store.undo.undo()
    expect(resolveMapModule(store.graph.getNode(node.id)?.interactiveProps?.module)).toMatchObject({
      ok: true,
      config: { center: [1, 2], zoom: 4, style: 'standard' }
    })

    store.undo.redo()
    expect(resolveMapModule(store.graph.getNode(node.id)?.interactiveProps?.module)).toMatchObject({
      ok: true,
      config: { zoom: 9, style: 'dark' }
    })
  })

  test('honors plugin enablement for creation without disabling existing module updates', async () => {
    let moduleCreationEnabled = true
    const { handle, page, store, target } = setup(() => moduleCreationEnabled)
    const existing = store.graph.createNode(
      'FRAME',
      page.id,
      createMapModuleFrameOverrides({ zoom: 4 })
    )
    moduleCreationEnabled = false
    try {
      const denied = await handle(target, {
        name: 'create_module',
        args: { plugin_id: MAP_PLUGIN_ID, module_type: MAP_MODULE_TYPE }
      })
      expect(denied).toMatchObject({
        ok: true,
        result: {
          ok: false,
          error: `Module ${MAP_PLUGIN_ID}/${MAP_MODULE_TYPE} is not enabled`
        }
      })

      const updated = await handle(target, {
        name: 'update_module',
        args: {
          id: existing.id,
          plugin_id: MAP_PLUGIN_ID,
          module_type: MAP_MODULE_TYPE,
          config: { zoom: 7 }
        }
      })
      expect(updated).toMatchObject({ ok: true, result: { ok: true } })
      expect(
        resolveMapModule(store.graph.getNode(existing.id)?.interactiveProps?.module)
      ).toMatchObject({ ok: true, config: { zoom: 7 } })
    } finally {
      moduleCreationEnabled = true
    }
  })
})
