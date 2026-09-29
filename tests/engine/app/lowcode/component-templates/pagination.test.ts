import { expect, test } from 'bun:test'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { resolvePaginationModule } from '@open-pencil/core/plugins'
import { validateExpression } from '@open-pencil/lowcode'

import { getComponentTemplates } from '@/app/lowcode/component-templates'

import {
  compileComponentTemplates,
  componentTemplateFixture
} from '#tests/helpers/compiler/components/templates/fixture'

test('pagination recipes keep independent page state and list references through FIG readback', async () => {
  const fixture = componentTemplateFixture(['pagination', 'paginated-list'], 'zh-CN')
  try {
    const catalog = getComponentTemplates('en')
    expect(catalog).toHaveLength(62)
    expect(catalog.filter((item) => item.kind === 'basic')).toHaveLength(54)
    expect(catalog.filter((item) => item.kind === 'combination')).toHaveLength(8)
    const nodes = [...fixture.graph.getAllNodes()]
    const pagers = nodes.filter(
      (node) => node.interactiveProps?.module?.moduleType === 'pagination'
    )
    expect(pagers).toHaveLength(2)
    const currentPages = pagers.map((node) => node.bindings?.currentPage)
    expect(currentPages[0]).not.toEqual(currentPages[1])
    for (const pager of pagers) {
      expect(resolvePaginationModule(pager.interactiveProps.module)?.ok).toBe(true)
      const binding = pager.bindings?.currentPage
      if (binding?.kind !== 'ref') throw new Error('Pagination requires a page-state binding')
      expect(
        fixture.graph.getNode(fixture.pageId)?.state?.find((state) => state.id === binding.stateId)
      ).toMatchObject({ type: 'number', defaultValue: 1 })
    }
    const list = nodes.find((node) => node.type === 'LIST')
    expect(list?.interactiveProps.dataSourceRef).toMatchObject({ kind: 'stateRef' })
    const row = list && fixture.graph.getNode(list.childIds[0])
    expect(row?.renderCondition).toContain('recordIndex')
    expect(validateExpression(row?.renderCondition ?? '').ok).toBe(true)
    await initCodec()
    const restored = await parseFigFile((await exportFigFile(fixture.graph)).slice().buffer)
    const reopened = [...restored.getAllNodes()]
    for (const original of [...pagers, list, row]) {
      if (!original) throw new Error('Pagination template node missing')
      const match = reopened.find(
        (node) =>
          node.name === original.name &&
          JSON.stringify(node.bindings) === JSON.stringify(original.bindings)
      )
      expect(match?.interactiveProps).toEqual(original.interactiveProps)
      expect(match?.renderCondition).toEqual(original.renderCondition)
    }
  } finally {
    fixture.editor.dispose()
  }
})

for (const target of ['react', 'vue'] as const)
  test(`${target}: pagination recipes compile page controls and list filtering without warnings`, () => {
    const output = compileComponentTemplates(target, ['pagination', 'paginated-list'], 'zh-CN')
    expect(output.warnings).toEqual([])
    const source = [...output.files.values()].join('\n')
    expect(source).toContain('OpenPencilPagination')
    expect(source).toContain('recordIndex')
    expect(source).toContain('template2_records')
  })
