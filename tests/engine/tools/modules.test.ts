import { describe, expect, test } from 'bun:test'

import {
  CHART_MODULE_TYPE,
  CHART_PLUGIN_ID,
  MAP_MODULE_TYPE,
  MAP_PLUGIN_ID
} from '@open-pencil/core/plugins'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

describe('module tools', () => {
  test('lists, creates, and reads a native FRAME module', () => {
    const { figma, graph } = setupToolTest()
    const listed = getTool('list_modules').execute(figma, {}) as Result<{
      modules: Array<{ pluginId: string; moduleType: string }>
    }>
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.data.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pluginId: MAP_PLUGIN_ID, moduleType: MAP_MODULE_TYPE }),
        expect.objectContaining({ pluginId: CHART_PLUGIN_ID, moduleType: CHART_MODULE_TYPE })
      ])
    )

    const created = getTool('create_module').execute(figma, {
      plugin_id: MAP_PLUGIN_ID,
      module_type: MAP_MODULE_TYPE,
      x: 24,
      y: 32,
      config: { center: [116.4074, 39.9042], zoom: 10 }
    }) as Result<{ id: string; type: string }>
    expect(created).toMatchObject({ ok: true, data: { type: 'FRAME' } })
    if (!created.ok) return
    const node = graph.getNode(created.data.id)
    expect(node).toMatchObject({ type: 'FRAME', x: 24, y: 32 })

    const read = getTool('read_module').execute(figma, { id: created.data.id }) as Result<{
      module: { pluginId: string; moduleType: string }
      config: { zoom: number }
    }>
    expect(read).toMatchObject({
      ok: true,
      data: {
        module: { pluginId: MAP_PLUGIN_ID, moduleType: MAP_MODULE_TYPE },
        config: { zoom: 10 }
      }
    })
  })

  test('updates with an identity guard and one graph mutation', () => {
    const { figma, graph } = setupToolTest()
    const created = getTool('create_module').execute(figma, {
      plugin_id: MAP_PLUGIN_ID,
      module_type: MAP_MODULE_TYPE,
      config: { center: [1, 2], zoom: 4 }
    }) as Result<{ id: string }>
    if (!created.ok) throw new Error(created.error)

    let updates = 0
    const unbind = graph.onNodeEvents({
      updated: (id) => {
        if (id === created.data.id) updates += 1
      }
    })
    const updated = getTool('update_module').execute(figma, {
      id: created.data.id,
      plugin_id: MAP_PLUGIN_ID,
      module_type: MAP_MODULE_TYPE,
      config: { zoom: 7 }
    }) as Result<{ config: { center: [number, number]; zoom: number } }>
    unbind()
    expect(updated).toMatchObject({ ok: true, data: { config: { center: [1, 2], zoom: 7 } } })
    expect(updates).toBe(1)

    const guarded = getTool('update_module').execute(figma, {
      id: created.data.id,
      plugin_id: 'wrong.plugin',
      module_type: MAP_MODULE_TYPE,
      config: { zoom: 9 }
    }) as Result<unknown>
    expect(guarded.ok).toBe(false)
    expect(graph.getNode(created.data.id)?.interactiveProps?.module).toMatchObject({
      config: { zoom: 7 }
    })
  })

  test('rejects invalid configs and non-container parents without mutation', () => {
    const { figma, graph } = setupToolTest()
    const page = graph.getPages()[0]
    const rectangle = graph.createNode('RECTANGLE', page.id)
    const invalidParent = getTool('create_module').execute(figma, {
      plugin_id: MAP_PLUGIN_ID,
      module_type: MAP_MODULE_TYPE,
      parent_id: rectangle.id
    }) as Result<unknown>
    expect(invalidParent.ok).toBe(false)

    const invalidConfig = getTool('create_module').execute(figma, {
      plugin_id: MAP_PLUGIN_ID,
      module_type: MAP_MODULE_TYPE,
      config: { token: 'must-not-persist' }
    }) as Result<unknown>
    expect(invalidConfig.ok).toBe(false)
    expect([...graph.getAllNodes()].some((node) => node.interactiveProps?.module)).toBe(false)
  })

  test('applies the host enablement gate only to discovery and creation', () => {
    const { figma } = setupToolTest()
    const canCreateModule = (pluginId: string) => pluginId !== MAP_PLUGIN_ID
    const context = { canCreateModule }
    const listed = getTool('list_modules').execute(figma, {}, context) as Result<{
      modules: Array<{ pluginId: string; moduleType: string }>
    }>
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.data.modules.some((module) => module.pluginId === MAP_PLUGIN_ID)).toBe(false)
    expect(listed.data.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pluginId: CHART_PLUGIN_ID, moduleType: CHART_MODULE_TYPE })
      ])
    )

    const denied = getTool('create_module').execute(
      figma,
      { plugin_id: MAP_PLUGIN_ID, module_type: MAP_MODULE_TYPE },
      context
    ) as Result<unknown>
    expect(denied).toEqual({
      ok: false,
      error: `Module ${MAP_PLUGIN_ID}/${MAP_MODULE_TYPE} is not enabled`
    })
  })
})
