import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'

import {
  orgChartFixture,
  orgChartGraph
} from '#tests/helpers/compiler/components/org-chart/fixture'
import { orgChartRuntimeFixture } from '#tests/helpers/compiler/components/org-chart/runtime'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const target of ['react', 'vue'] as const)
  test(`${target} Org Chart emits a typed, offline project`, () => {
    const result = orgChartFixture(target)
    expect(result.warnings).toEqual([])
    const runtime = result.files.get(
      `src/__openpencil_org_chart.${target === 'react' ? 'tsx' : 'vue'}`
    )
    expect(runtime).toContain('role="tree"')
    expect(runtime).not.toMatch(/fetch\(|localStorage|sessionStorage|navigator\./)
    typeCheckCompilerFiles(result.files, target)
    typeCheckCompilerFiles(orgChartRuntimeFixture(target).files, target)
  }, 35000)

for (const mutation of ['version', 'cycle', 'too-many', 'getter'] as const)
  test(`Org Chart rejects ${mutation} without gaining module authority`, () => {
    const { graph, page, main } = orgChartGraph()
    const module = main.interactiveProps?.module
    if (!module) throw new Error('Fixture has no module')
    const config = module.config
    let changed = { ...module }
    if (mutation === 'version') changed.configVersion = 99
    if (mutation === 'cycle')
      changed.config = {
        ...config,
        items: [{ id: 'a', parentId: 'a', label: 'A', description: '' }]
      }
    if (mutation === 'too-many')
      changed.config = {
        ...config,
        items: Array.from({ length: 65 }, (_, index) => ({
          id: 'n' + index,
          parentId: '',
          label: 'Node',
          description: ''
        }))
      }
    if (mutation === 'getter') {
      changed = { ...module, config: { ...config } }
      Object.defineProperty(changed.config, 'items', {
        get() {
          throw new Error('Must not execute config getter')
        },
        enumerable: true
      })
    }
    graph.updateNode(main.id, { interactiveProps: { module: changed } })
    const tree = collectTree(graph, page.id)
    expect(tree.warnings.length).toBeGreaterThan(0)
    expect(JSON.stringify(tree.children)).not.toContain('"moduleType":"org-chart"')
  })
for (const target of ['expo', 'flutter', 'taro', 'wechat-miniprogram', 'uni-app', 'mpx'] as const)
  test(`${target} explicitly warns about unsupported Org Chart runtime`, () => {
    const { graph, page } = orgChartGraph()
    const result = compile({ graph, pageIds: [page.id], options: withDefaults({ target }) })
    const expected = {
      expo: 'expo-module-unsupported',
      flutter: 'flutter-element-feature-unsupported',
      taro: 'taro-plugin-module-unsupported',
      'wechat-miniprogram': 'wechat-miniprogram-node-runtime-unsupported',
      'uni-app': 'uni-app-plugin-module-unsupported',
      mpx: 'mpx-plugin-module-unsupported'
    }
    expect(result.warnings.some((warning) => warning.code === expected[target])).toBe(true)
    expect([...result.files.values()].join('\n')).not.toContain('data-openpencil-org-chart')
  })
test('Org Chart survives fig roundtrip as an ordinary FRAME with local declarative data', async () => {
  await initCodec()
  const { graph, main } = orgChartGraph()
  const restored = await parseFigFile((await exportFigFile(graph)).slice().buffer)
  const node = [...restored.getAllNodes()].find((node) => node.name === main.name)
  expect(node?.type).toBe('FRAME')
  expect(node?.interactiveProps?.module).toEqual(main.interactiveProps?.module)
  expect(node?.bindings).toEqual(main.bindings)
})

test('unknown module identities cannot acquire Org Chart runtime authority', () => {
  const { graph, page, main } = orgChartGraph()
  const module = main.interactiveProps?.module
  if (!module) throw new Error('Fixture has no module')
  graph.updateNode(main.id, {
    interactiveProps: { module: { ...module, pluginId: 'unknown.org-chart' } }
  })
  const result = compile({ graph, pageIds: [page.id], options: withDefaults({ target: 'react' }) })
  expect([...result.files.keys()].some((path) => path.includes('__openpencil_org_chart'))).toBe(
    false
  )
  expect(JSON.stringify(collectTree(graph, page.id).children)).not.toContain(
    '"moduleType":"org-chart"'
  )
})
