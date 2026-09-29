import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { createWalktourModuleInstance } from '@open-pencil/core/plugins'

import { walktourFixture, walktourGraph } from '#tests/helpers/compiler/components/walktour/fixture'
import { walktourRuntimeFixture } from '#tests/helpers/compiler/components/walktour/runtime'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const target of ['react', 'vue'] as const)
  test(`${target} Walktour emits a typed scoped project and interaction fixture`, () => {
    const result = walktourFixture(target)
    expect(result.warnings).toEqual([])
    const runtime = result.files.get(
      `src/__openpencil_walktour.${target === 'react' ? 'tsx' : 'vue'}`
    )
    expect(runtime).toContain('showModal')
    expect(runtime).not.toMatch(/fetch\(|localStorage|sessionStorage/)
    typeCheckCompilerFiles(result.files, target)
    typeCheckCompilerFiles(walktourRuntimeFixture(target).files, target)
  }, 35000)
for (const target of ['react', 'vue'] as const)
  test(`${target} microfrontends refuse Walktour overlays before emitting`, () => {
    const { graph, page } = walktourGraph()
    expect(() =>
      compile({
        graph,
        pageIds: [page.id],
        options: withDefaults({
          target,
          devMode: false,
          packaging: { kind: 'microfrontend', appId: 'walktour-test' }
        })
      })
    ).toThrow('overlay modules')
  })
for (const target of ['expo', 'flutter', 'taro', 'wechat-miniprogram', 'uni-app', 'mpx'] as const)
  test(`${target} rejects unsupported Walktour interaction explicitly`, () => {
    const { graph, page } = walktourGraph(),
      result = compile({ graph, pageIds: [page.id], options: withDefaults({ target }) })
    const codes = {
      expo: 'expo-module-unsupported',
      flutter: 'flutter-element-feature-unsupported',
      taro: 'taro-plugin-module-unsupported',
      'wechat-miniprogram': 'wechat-miniprogram-node-runtime-unsupported',
      'uni-app': 'uni-app-plugin-module-unsupported',
      mpx: 'mpx-plugin-module-unsupported'
    }
    expect(result.warnings.some((warning) => warning.code === codes[target])).toBe(true)
    expect([...result.files.keys()].some((path) => path.includes('__openpencil_walktour'))).toBe(
      false
    )
  })
test('unknown Walktour versions cannot gain runtime or child-slot authority', () => {
  const { graph, page, main } = walktourGraph()
  graph.updateNode(main.id, {
    interactiveProps: { module: { ...createWalktourModuleInstance(), configVersion: 99 } }
  })
  const tree = collectTree(graph, page.id),
    node = tree.children[0] as IRElement
  expect(node.module).toBeUndefined()
  expect(tree.warnings.length).toBeGreaterThan(0)
})
test('Walktour fig roundtrip keeps ordinary child geometry and only declarative guide data', async () => {
  await initCodec()
  const { graph, main, profile } = walktourGraph(),
    restored = await parseFigFile((await exportFigFile(graph)).slice().buffer)
  const node = [...restored.getAllNodes()].find((node) => node.name === main.name),
    child = [...restored.getAllNodes()].find((node) => node.name === profile.name)
  expect(node?.type).toBe('FRAME')
  expect(node?.interactiveProps?.module).toEqual(main.interactiveProps?.module)
  expect(child).toMatchObject({
    x: profile.x,
    y: profile.y,
    width: profile.width,
    height: profile.height
  })
})
