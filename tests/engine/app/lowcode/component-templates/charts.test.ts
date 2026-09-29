import { expect, test } from 'bun:test'

import { resolveChartModule, CHART_MODULE_DEFINITION } from '@open-pencil/core/plugins'

import { getComponentTemplates } from '@/app/lowcode/component-templates'
import { localizedAppPluginModulePropertyText } from '@/app/plugins/localization'

import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'

test('five chart recipes declare their module requirement and preserve local paired data', () => {
  const templates = getComponentTemplates('zh-CN').filter((item) =>
    item.requiredModules.some(
      (module) => module.pluginId === 'open-pencil.chart' && module.moduleType === 'chart'
    )
  )
  expect(templates).toHaveLength(5)
  for (const template of templates) {
    expect(template.kind).toBe('basic')
    expect(template.requiredModules).toEqual([
      { pluginId: 'open-pencil.chart', moduleType: 'chart' }
    ])
    const { editor, graph } = componentTemplateFixture([template.id], 'zh-CN')
    try {
      const node = [...graph.getAllNodes()].find((candidate) => candidate.interactiveProps?.module)
      const resolved = resolveChartModule(node?.interactiveProps?.module)
      if (!resolved?.ok) throw new Error('Missing chart template module')
      expect(node?.type).toBe('FRAME')
      expect(node?.interactiveProps?.lang).toBe('zh-CN')
      expect(resolved.config.chartType).toBe(template.id.replace('-chart', ''))
      expect(resolved.config.labels).toHaveLength(resolved.config.values.length)
      expect(resolved.config.labels.every((label) => /\p{Script=Han}/u.test(label))).toBe(true)
      expect(resolved.config.showValues).toBe(true)
      expect(node?.bindings ?? []).toEqual([])
      expect(node?.events ?? []).toEqual([])
    } finally {
      editor.dispose()
    }
  }
})

test('all chart type choices have Chinese inspector labels', () => {
  const field = CHART_MODULE_DEFINITION.fields.find((entry) => entry.path[0] === 'chartType')
  expect(field?.options).toEqual(['bar', 'line', 'area', 'pie', 'donut'])
  for (const option of field?.options ?? [])
    expect(
      localizedAppPluginModulePropertyText(`${field?.i18nLabelKey}:${option}`, 'zh-CN')
    ).toBeTruthy()
})
