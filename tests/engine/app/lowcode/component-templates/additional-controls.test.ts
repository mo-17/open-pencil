import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { createComponentTemplate, getComponentTemplates } from '@/app/lowcode/component-templates'

import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

const ids = ['slider', 'range-slider', 'rating', 'stepper', 'breadcrumb'] as const

function assertInitialConfig(
  id: (typeof ids)[number],
  config: JSONObject | undefined,
  locale: string
) {
  if (id === 'range-slider')
    expect(config).toMatchObject({ range: true, initialValue: 25, initialEndValue: 75 })
  if (id === 'rating') expect(config).toMatchObject({ allowHalf: true, initialValue: 3.5 })
  if (id === 'stepper') expect(config).toMatchObject({ allowStepClick: true, currentIndex: 1 })
  if (id === 'breadcrumb')
    expect(config?.items).toEqual(
      locale === 'en'
        ? [
            { label: 'Home', href: '#top' },
            { label: 'Library', href: '' },
            { label: 'Current page', href: '' }
          ]
        : [
            { label: '首页', href: '#top' },
            { label: '组件库', href: '' },
            { label: '当前页面', href: '' }
          ]
    )
}

test('new control templates declare their required modules and bilingual local-state boundaries', () => {
  for (const locale of ['en', 'zh-CN']) {
    const catalog = getComponentTemplates(locale)
    expect(catalog.filter((item) => item.kind === 'basic')).toHaveLength(54)
    expect(catalog.filter((item) => item.kind === 'combination')).toHaveLength(8)
    for (const id of ids) {
      const item = catalog.find((candidate) => candidate.id === id)
      const moduleType = id === 'range-slider' ? 'slider' : id
      expect(item?.requiredModules).toEqual([{ pluginId: `open-pencil.${moduleType}`, moduleType }])
      expect(item?.kind).toBe('basic')
      expect(item?.targets).toEqual(['react', 'vue'])
      if (id === 'slider' || id === 'range-slider' || id === 'rating')
        expect(item?.limitations.some((text) => /FORM|表单字段/.test(text))).toBe(true)
    }
  }
})

for (const locale of ['en', 'zh-CN']) {
  test.each(ids)(
    `${locale} %s inserts an editable module in one undo batch without unrelated state`,
    (id) => {
      const { editor, graph, pageId } = componentTemplateFixture([])
      try {
        const preserved = graph.createNode('TEXT', pageId, {
          text: 'Keep me',
          name: 'Existing note'
        })
        const before = structuredClone(preserved)
        const result = createComponentTemplate(editor, id, locale, { parentId: pageId })
        const nodes = result.nodeIds.map((nodeId) => graph.getNode(nodeId))
        const modules = nodes.filter((node) => node?.interactiveProps?.module)
        expect(modules).toHaveLength(1)
        const module = modules[0]?.interactiveProps?.module
        expect(module?.pluginId).toBe(`open-pencil.${id === 'range-slider' ? 'slider' : id}`)
        expect(module?.configVersion).toBe(1)
        expect(modules[0]?.type).toBe('FRAME')
        expect(modules[0]?.counterAxisSizing).toBe('FILL')
        expect(modules[0]?.width).toBe(320)
        const expectedStates = {
          slider: 1,
          'range-slider': 2,
          rating: 1,
          stepper: 0,
          breadcrumb: 0
        }
        expect(result.stateNames).toHaveLength(expectedStates[id])
        expect(nodes.every((node) => !node?.events?.length)).toBe(true)
        assertInitialConfig(id, module?.config, locale)
        expect(graph.getNode(preserved.id)).toEqual(before)
        editor.undo.undo()
        expect(result.nodeIds.every((nodeId) => !graph.getNode(nodeId))).toBe(true)
        expect(graph.getNode(preserved.id)).toEqual(before)
        editor.undo.redo()
        expect(graph.getNode(result.rootId)).toBeDefined()
        expect(graph.getNode(modules[0]?.id ?? '')?.interactiveProps?.module).toEqual(module)
      } finally {
        editor.dispose()
      }
    }
  )

  test(`${locale} added templates retain module settings through fig and compile to both web targets`, async () => {
    await initCodec()
    const { editor, graph } = componentTemplateFixture(ids, locale)
    const moduleRows = (source: typeof graph) =>
      [...source.getAllNodes()]
        .filter((node) => node.interactiveProps?.module)
        .map((node) => ({ name: node.name, module: node.interactiveProps?.module }))
        .sort((a, b) => a.name.localeCompare(b.name))
    try {
      const restored = await parseFigFile((await exportFigFile(graph)).slice().buffer)
      expect(moduleRows(restored)).toEqual(moduleRows(graph))
      for (const target of ['react', 'vue'] as const) {
        const result = compile({
          graph: restored,
          pageIds: [restored.getPages()[0].id],
          options: withDefaults({ target, devMode: false, router: 'none', lang: locale })
        })
        expect(result.warnings).toEqual([])
        const files = new Map<string, string>()
        for (const [path, content] of result.files)
          if (typeof content === 'string') files.set(path, content)
        expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
      }
    } finally {
      editor.dispose()
    }
  }, 35_000)
}
