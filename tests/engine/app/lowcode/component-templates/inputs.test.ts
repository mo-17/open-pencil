import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import {
  resolveDateRangeModule,
  resolvePopoverModule,
  resolveTreeModule
} from '@open-pencil/core/plugins'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { getComponentTemplates } from '@/app/lowcode/component-templates'

import {
  componentTemplateFixture,
  compileComponentTemplates
} from '#tests/helpers/compiler/components/templates/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

const ids = ['multi-select', 'date-range', 'tree', 'tree-select', 'popover', 'popconfirm'] as const

function expectTreeTemplateBindings(graph: SceneGraph, envelopes: SceneNode[]): SceneNode[] {
  const trees = envelopes
    .map((node) => resolveTreeModule(node.interactiveProps?.module))
    .filter((result) => result?.ok)
  expect(trees.map((result) => (result && result.ok ? result.config.presentation : ''))).toEqual([
    'tree',
    'select'
  ])
  const treeNodes = envelopes.filter((node) => resolveTreeModule(node.interactiveProps?.module)?.ok)
  for (const [index, node] of treeNodes.entries()) {
    const binding = node.bindings?.value
    if (binding?.kind !== 'ref') throw new Error('Tree template needs a page value binding')
    const declaration = graph.getPages()[0].state?.find((state) => state.id === binding.stateId)
    expect(declaration?.type).toBe(index === 0 ? 'array' : 'string')
    expect(declaration?.defaultValue).toEqual(index === 0 ? ['design'] : 'design')
  }
  return treeNodes
}

test('six input and popup recipes declare exact dependencies and local behavior boundaries', () => {
  const catalog = getComponentTemplates('en')
  expect(catalog).toHaveLength(66)
  expect(catalog.filter((item) => item.kind === 'basic')).toHaveLength(54)
  expect(catalog.filter((item) => item.kind === 'combination')).toHaveLength(12)
  for (const id of ids) {
    const item = catalog.find((entry) => entry.id === id)
    const groupedModules: Partial<Record<(typeof ids)[number], string>> = {
      'tree-select': 'tree',
      popconfirm: 'popover'
    }
    const moduleType = groupedModules[id] ?? id
    expect(item?.requiredModules).toEqual(
      id === 'multi-select' ? [] : [{ pluginId: 'open-pencil.' + moduleType, moduleType }]
    )
    expect(item?.kind).toBe('basic')
    let boundary = 'FORM'
    if (id === 'multi-select') boundary = 'page-state'
    if (id === 'tree' || id === 'tree-select') boundary = 'remote loading'
    if (id === 'popover' || id === 'popconfirm') boundary = 'business form'
    expect(item?.limitations.some((text) => text.includes(boundary))).toBe(true)
  }
})
for (const locale of ['en', 'zh-CN'])
  test(`${locale} input recipes retain page-array bindings and strict local modules through FIG and typed web exports`, async () => {
    await initCodec()
    const fixture = componentTemplateFixture(ids, locale)
    try {
      const nodes = [...fixture.graph.getAllNodes()]
      const select = nodes.find((node) => node.type === 'SELECT')
      expect(select?.interactiveProps).toMatchObject({
        multiple: true,
        showSearch: true,
        allowClear: true
      })
      const binding = select?.bindings?.value
      if (binding?.kind !== 'ref') throw new Error('Multiple select must bind to page state')
      const state = fixture.graph.getPages()[0].state?.find((item) => item.id === binding.stateId)
      expect(state?.type).toBe('array')
      expect(state?.defaultValue).toEqual(['design'])
      expect(fixture.graph.getNode(fixture.graph.rootId)?.lowcodeDocumentState ?? []).toEqual([])
      const envelopes = nodes.filter((node) => node.interactiveProps?.module)
      expect(envelopes).toHaveLength(5)
      expect(
        envelopes.every(
          (node) => node.type === 'FRAME' && Object.keys(node.events ?? {}).length === 0
        )
      ).toBe(true)
      expect(
        envelopes
          .map((node) => Object.keys(node.bindings ?? {}).sort())
          .filter((keys) => keys.length)
      ).toEqual([['endValue', 'value'], ['value'], ['value']])
      const date = envelopes
        .map((node) => resolveDateRangeModule(node.interactiveProps?.module))
        .find((result) => result?.ok)
      expect(date && date.ok ? date.config : undefined).toMatchObject({
        initialStart: '2026-09-01',
        initialEnd: '2026-09-05'
      })
      const treeNodes = expectTreeTemplateBindings(fixture.graph, envelopes)
      const popovers = envelopes
        .map((node) => resolvePopoverModule(node.interactiveProps?.module))
        .filter((result) => result?.ok)
      expect(popovers.map((result) => (result && result.ok ? result.config.mode : ''))).toEqual([
        'popover',
        'confirm'
      ])
      const restored = await parseFigFile((await exportFigFile(fixture.graph)).slice().buffer)
      const moduleRows = (graph: typeof restored) =>
        [...graph.getAllNodes()]
          .filter((node) => node.interactiveProps?.module)
          .map((node) => JSON.stringify(node.interactiveProps))
          .sort()
      expect(moduleRows(restored)).toEqual(moduleRows(fixture.graph))
      expect(restored.getPages()[0].state).toEqual(fixture.graph.getPages()[0].state)
      expect(
        [...restored.getAllNodes()]
          .filter((node) => resolveTreeModule(node.interactiveProps?.module)?.ok)
          .map((node) => node.bindings)
      ).toEqual(treeNodes.map((node) => node.bindings))
      expect([...restored.getAllNodes()].find((node) => node.type === 'SELECT')?.bindings).toEqual(
        select?.bindings
      )
      for (const target of ['react', 'vue'] as const) {
        const result = compile({
          graph: restored,
          pageIds: [restored.getPages()[0].id],
          options: withDefaults({ target, router: 'none', devMode: false, lang: locale })
        })
        expect(result.warnings).toEqual([])
        typeCheckCompilerFiles(
          new Map(
            [...result.files].filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          ),
          target
        )
      }
    } finally {
      fixture.editor.dispose()
    }
  }, 35000)

test('template exports declare their language for native and shared control copy', () => {
  for (const target of ['react', 'vue'] as const)
    for (const locale of ['en', 'zh-CN']) {
      const output = compileComponentTemplates(target, ['multi-select'], locale)
      expect(output.files.get('index.html')).toContain(`<html lang="${locale}">`)
    }
})
