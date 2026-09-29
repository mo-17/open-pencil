import { beforeAll, expect, test } from 'bun:test'

import { DESCRIPTIONS_COMPILER_MODULE_LOWERER } from '#compiler/modules/descriptions'

import { compile, withDefaults } from '@open-pencil/compiler'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import {
  createDescriptionsModuleFrameOverrides,
  createDescriptionsModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

beforeAll(initCodec)

test('Descriptions lowerer preserves literal strings and rejects unsupported versions', () => {
  const instance = createDescriptionsModuleInstance({
    items: [{ id: 'literal', label: '<b>Label</b>', value: '{{value}} & 中文' }]
  })
  expect(DESCRIPTIONS_COMPILER_MODULE_LOWERER.lower(instance)).toEqual({
    ok: true,
    payload: instance.config
  })
  expect(DESCRIPTIONS_COMPILER_MODULE_LOWERER.lower({ ...instance, configVersion: 2 }).ok).toBe(
    false
  )
})

test('Descriptions ordinary FRAME and authored layout survive two FIG save/reopen cycles', async () => {
  let graph = new SceneGraph()
  const node = graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createDescriptionsModuleFrameOverrides({
      columns: 3,
      layout: 'vertical',
      bordered: false,
      density: 'compact',
      items: [
        { id: 'name', label: '项目', value: '示例\nEnglish' },
        { id: 'empty', label: '备注', value: '' }
      ]
    })
  )
  const expected = structuredClone(node.interactiveProps?.module)
  for (let cycle = 0; cycle < 2; cycle++) {
    graph = await parseFigFile((await exportFigFile(graph)).slice().buffer)
    const restored = [...graph.getAllNodes()].find((entry) => entry.name === node.name)
    expect(restored?.type).toBe('FRAME')
    expect(restored?.interactiveProps?.module).toEqual(expected)
    for (const target of ['react', 'vue'] as const) {
      const output = compile({
        graph,
        pageIds: [graph.getPages()[0].id],
        options: withDefaults({ target, router: 'none', devMode: false })
      })
      expect(output.warnings).toEqual([])
      expect(
        [...output.files.keys()].some((path) => path.includes('__openpencil_descriptions'))
      ).toBe(true)
    }
  }
})

test.each([
  ['expo', 'expo-module-unsupported'],
  ['flutter', 'flutter-element-feature-unsupported'],
  ['wechat-miniprogram', 'wechat-miniprogram-node-runtime-unsupported'],
  ['taro', 'taro-plugin-module-unsupported'],
  ['uni-app', 'uni-app-plugin-module-unsupported'],
  ['mpx', 'mpx-plugin-module-unsupported']
] as const)('%s explicitly warns that Descriptions is unsupported', (target, code) => {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  const node = graph.createNode('FRAME', page.id, createDescriptionsModuleFrameOverrides())
  const output = compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  expect(
    output.warnings.some((warning) => warning.nodeId === node.id && warning.code === code)
  ).toBe(true)
  expect([...output.files.keys()].some((path) => path.includes('__openpencil_descriptions'))).toBe(
    false
  )
})
