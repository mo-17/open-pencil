import { CHART_MODULE_DEFINITION } from '@open-pencil/core/plugins'

import type { TemplateContext } from './presentation'

type ChartTemplateId = 'bar-chart' | 'line-chart' | 'area-chart' | 'pie-chart' | 'donut-chart'
const TYPES = {
  'bar-chart': 'bar',
  'line-chart': 'line',
  'area-chart': 'area',
  'pie-chart': 'pie',
  'donut-chart': 'donut'
} as const

export function isChartTemplateId(id: string): id is ChartTemplateId {
  return Object.hasOwn(TYPES, id)
}

export function addChartTemplate(ctx: TemplateContext, parent: string, id: ChartTemplateId) {
  const circular = id === 'pie-chart' || id === 'donut-chart'
  const frame = CHART_MODULE_DEFINITION.createFrameOverrides({
    chartType: TYPES[id],
    labels: circular
      ? [ctx.copy('Design', '设计'), ctx.copy('Development', '开发'), ctx.copy('Review', '评审')]
      : [
          ctx.copy('Jan', '一月'),
          ctx.copy('Feb', '二月'),
          ctx.copy('Mar', '三月'),
          ctx.copy('Apr', '四月')
        ],
    values: circular ? [35, 45, 20] : [32, -12, 46, 68],
    color: '#2563EB',
    showValues: true
  })
  ctx.node('FRAME', parent, frame.name ?? 'Chart', {
    ...frame,
    height: 260,
    counterAxisSizing: 'FILL',
    interactiveProps: { ...frame.interactiveProps, lang: ctx.zh ? 'zh-CN' : 'en' }
  })
}
