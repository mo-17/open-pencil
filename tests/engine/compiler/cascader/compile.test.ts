import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { createCascaderModuleInstance } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

import { cascaderRuntimeFixture } from '#tests/helpers/compiler/components/cascader/runtime'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const target of ['react', 'vue'] as const)
  test(`${target} Cascader compiles typed controlled and local source without remote data authority`, () => {
    const graph = new SceneGraph(),
      page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [
        {
          id: 'location',
          name: 'location',
          type: 'array',
          defaultValue: ['asia', 'china', 'xiamen']
        }
      ]
    })
    graph.createNode('FRAME', page.id, {
      name: 'Location',
      width: 320,
      height: 44,
      bindings: { value: { kind: 'ref', stateId: 'location' } },
      interactiveProps: { module: createCascaderModuleInstance() }
    })
    graph.createNode('FRAME', page.id, {
      name: 'Local',
      y: 80,
      width: 320,
      height: 44,
      interactiveProps: { module: createCascaderModuleInstance() }
    })
    const result = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ target, devMode: false })
    })
    expect(result.warnings).toEqual([])
    const source = result.files.get(
      `src/__openpencil_cascader.${target === 'react' ? 'tsx' : 'vue'}`
    )
    expect(source).toBeDefined()
    expect(source).not.toMatch(/fetch\(|localStorage|sessionStorage|dangerouslySetInnerHTML|v-html/)
    typeCheckCompilerFiles(result.files, target)
    typeCheckCompilerFiles(cascaderRuntimeFixture(target).files, target)
  }, 35000)
