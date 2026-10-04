import { describe, expect, test } from 'bun:test'

import { vueAdapter } from '#compiler/adapters/vue'
import { findVueModuleAdapter } from '#compiler/adapters/vue/modules/registry'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

import { withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import { BUILTIN_PLUGIN_REGISTRY } from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

describe('bundled Vue module coverage', () => {
  test('every Core bundled module identity has a matching Vue runtime', () => {
    const modules = BUILTIN_PLUGIN_REGISTRY.listModules()
    expect(modules).toHaveLength(42)
    for (const module of modules) {
      const adapter = findVueModuleAdapter(module)
      expect(adapter).not.toBeNull()
      expect(adapter?.pluginId).toBe(module.pluginId)
      expect(adapter?.moduleType).toBe(module.moduleType)
    }
    expect(
      findVueModuleAdapter({ pluginId: 'open-pencil.html', moduleType: 'rich-text' })
    ).toBeNull()
  })

  test('compiles all default modules together and parses every emitted Vue SFC', () => {
    const graph = makeSceneGraph('All bundled Vue modules')
    const pageId = firstPageId(graph)
    for (const [index, module] of BUILTIN_PLUGIN_REGISTRY.listModules().entries()) {
      graph.createNode('FRAME', pageId, {
        ...module.createFrameOverrides(),
        x: (index % 3) * 700,
        y: Math.floor(index / 3) * 500
      })
    }
    const output = vueAdapter.emit(
      [collectTree(graph, pageId)],
      withDefaults({ target: 'vue', router: 'none', devMode: false }),
      []
    )
    expect(output.warnings).toEqual([])
    const components = [...output.files].filter(([path]) => path.endsWith('.vue'))
    expect(components.length).toBeGreaterThanOrEqual(42)
    for (const [filename, source] of components) {
      if (typeof source !== 'string') throw new Error('Vue SFC must be text')
      const parsed = parse(source, { filename })
      expect(parsed.errors).toEqual([])
      const script = parsed.descriptor.scriptSetup
        ? compileScript(parsed.descriptor, { id: filename })
        : undefined
      const template = compileTemplate({
        source: parsed.descriptor.template?.content ?? '',
        filename,
        id: filename,
        compilerOptions: { bindingMetadata: script?.bindings }
      })
      expect(template.errors).toEqual([])
    }
  })
})
