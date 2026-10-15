import { expect, test } from 'bun:test'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { resolveOrgChartModule } from '@open-pencil/core/plugins'
import { readModuleInstance } from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'
import {
  componentTemplateFixture,
  compileComponentTemplates
} from '#tests/helpers/compiler/components/templates/fixture'

test('org chart recipe is local editable text with no FORM, business state or binding and preserves FIG config', async () => {
  const f = componentTemplateFixture(['org-chart'], 'zh-CN')
  try {
    const nodes = [...f.graph.getAllNodes()]
    const chart = nodes.find(
      (node) => readModuleInstance(node.interactiveProps?.module)?.moduleType === 'org-chart'
    )
    if (!chart) throw new Error('Missing chart node')
    const module = resolveOrgChartModule(expectDefined(chart.interactiveProps).module)
    expect(module?.ok).toBe(true)
    if (!module?.ok) throw new Error('Missing chart')
    expect(module.config.items).toHaveLength(5)
    expect(module.config.items.map((item) => item.label)).toEqual([
      '产品团队',
      '设计',
      '研发',
      '前端',
      '后端'
    ])
    expect(nodes.some((node) => node.type === 'FORM')).toBe(false)
    expect(f.results[0].stateNames).toEqual([])
    expect(Object.keys(chart.bindings ?? {})).toEqual([])
    await initCodec()
    const restored = await parseFigFile((await exportFigFile(f.graph)).slice().buffer)
    const reopened = [...restored.getAllNodes()].find((node) => node.name === chart.name)
    expect(expectDefined(reopened?.interactiveProps).module).toEqual(
      expectDefined(chart.interactiveProps).module
    )
  } finally {
    f.editor.dispose()
  }
})

for (const target of ['react', 'vue'] as const)
  test(`${target}: org chart recipe compiles a standalone hierarchy without warnings`, () => {
    const output = compileComponentTemplates(target, ['org-chart'], 'zh-CN')
    expect(output.warnings).toEqual([])
    expect([...output.files.values()].join('\n')).toContain('OpenPencilOrgChart')
  })
