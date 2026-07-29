import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import { CORE_TOOLS } from '@open-pencil/core/tools'
import { SceneGraph } from '@open-pencil/scene-graph'

import type { GeneratedEffectRead } from '#core/tools/read'

import { expectDefined } from '#tests/helpers/assert'
import { generatedEffect } from '#tests/helpers/generated-effect'
import { getTool } from '#tests/helpers/tools'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

describe('generated-effect tools', () => {
  test('registers read/update/clear for both AI and MCP registries', () => {
    const names = new Set(CORE_TOOLS.map((tool) => tool.name))
    for (const name of [
      'read_generated_effect',
      'update_generated_effect',
      'clear_generated_effect'
    ]) {
      expect(names.has(name)).toBe(true)
      expect(getTool(name).name).toBe(name)
    }
  })

  test('updates, reads, clears, and undoes one isolated canonical layer', () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const editor = createEditor({ graph, skipInitialGraphSetup: true })
    const page = expectDefined(graph.getPages()[0], 'default page')
    const node = graph.createNode('RECTANGLE', page.id)
    const spec = generatedEffect('shimmer')

    const updated = getTool('update_generated_effect').execute(
      figma,
      { nodeId: node.id, specJson: JSON.stringify(spec) },
      { editor }
    ) as Result<{ nodeId: string; preset: string }>
    expect(updated).toMatchObject({ ok: true, data: { nodeId: node.id, preset: 'shimmer' } })
    expect(graph.getNode(node.id)?.generatedEffect).toEqual(spec)
    expect(graph.getNode(node.id)?.generatedEffect).not.toBe(spec)

    const read = getTool('read_generated_effect').execute(figma, {
      nodeId: node.id
    }) as Result<GeneratedEffectRead>
    expect(read).toMatchObject({
      ok: true,
      data: { id: node.id, preset: 'shimmer', animated: true, spec }
    })
    if (read.ok) expect(read.data.spec).not.toBe(graph.getNode(node.id)?.generatedEffect)

    const cleared = getTool('clear_generated_effect').execute(
      figma,
      { nodeId: node.id },
      { editor }
    ) as Result<{ cleared: boolean }>
    expect(cleared).toEqual({ ok: true, data: { nodeId: node.id, cleared: true } })
    expect(graph.getNode(node.id)?.generatedEffect).toBeUndefined()
    expect(editor.undo.undo()).toBe('AI: clear_generated_effect')
    expect(graph.getNode(node.id)?.generatedEffect).toEqual(spec)
  })

  test('rejects source code, unknown keys, future versions, and oversized JSON before mutation', () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const page = expectDefined(graph.getPages()[0], 'default page')
    const node = graph.createNode('RECTANGLE', page.id)
    for (const value of [
      { ...generatedEffect(), shader: 'fragment main() {}' },
      { ...generatedEffect(), version: 2 }
    ]) {
      const result = getTool('update_generated_effect').execute(figma, {
        nodeId: node.id,
        specJson: JSON.stringify(value)
      }) as Result<unknown>
      expect(result.ok).toBe(false)
      expect(graph.getNode(node.id)?.generatedEffect).toBeUndefined()
    }
    const oversized = getTool('update_generated_effect').execute(figma, {
      nodeId: node.id,
      specJson: `{"padding":"${'x'.repeat(70_000)}"}`
    }) as Result<unknown>
    expect(oversized.ok).toBe(false)
  })

  test('records explicit instance update and clear overrides', () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const page = expectDefined(graph.getPages()[0], 'default page')
    const component = graph.createNode('COMPONENT', page.id, {
      generatedEffect: generatedEffect('noise')
    })
    const instance = graph.createInstance(component.id, page.id)
    if (!instance) throw new Error('Expected instance')

    const authored = generatedEffect('scanlines')
    expect(
      getTool('update_generated_effect').execute(figma, {
        nodeId: instance.id,
        specJson: JSON.stringify(authored)
      })
    ).toMatchObject({ ok: true })
    expect(graph.getNode(instance.id)?.overrides.generatedEffect).toEqual(authored)

    expect(getTool('clear_generated_effect').execute(figma, { nodeId: instance.id })).toEqual({
      ok: true,
      data: { nodeId: instance.id, cleared: true }
    })
    expect(graph.getNode(instance.id)?.generatedEffect).toBeUndefined()
    expect(graph.getNode(instance.id)?.overrides.generatedEffect).toBeNull()
    graph.updateNode(component.id, { generatedEffect: generatedEffect('particles') })
    graph.syncInstances(component.id)
    expect(graph.getNode(instance.id)?.generatedEffect).toBeUndefined()
  })
})
