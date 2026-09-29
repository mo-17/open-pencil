import type { ChartModuleConfigV1 } from '#core/plugins/chart'

import {
  addChartText,
  addHiddenChartLabels,
  CHART_AXIS_COLOR,
  CHART_PALETTE,
  chartNumber
} from './primitives'
import type { ChartLayout } from './types'

function arcPoint(cx: number, cy: number, radius: number, angle: number): string {
  return `${chartNumber(cx + Math.cos(angle) * radius)} ${chartNumber(cy + Math.sin(angle) * radius)}`
}
function slicePath(
  cx: number,
  cy: number,
  radius: number,
  inner: number,
  from: number,
  to: number
): string {
  // Two arcs also represent a complete single-slice circle without coincident endpoint ambiguity.
  const mid = (from + to) / 2
  const outer = `M${arcPoint(cx, cy, radius, from)}A${radius} ${radius} 0 0 1 ${arcPoint(cx, cy, radius, mid)}A${radius} ${radius} 0 0 1 ${arcPoint(cx, cy, radius, to)}`
  if (!inner) return `${outer}L${cx} ${cy}Z`
  return `${outer}L${arcPoint(cx, cy, inner, to)}A${inner} ${inner} 0 0 0 ${arcPoint(cx, cy, inner, mid)}A${inner} ${inner} 0 0 0 ${arcPoint(cx, cy, inner, from)}Z`
}

function emptyCircularChart(model: ChartLayout): void {
  model.empty = true
  const { width, height } = model
  const radius = Math.max(0, Math.min(24, width / 4, height / 5))
  const cy = height / 2 - (model.compact ? 0 : 14)
  model.circles.push({
    x: width / 2,
    y: cy,
    radius,
    fill: 'none',
    stroke: CHART_AXIS_COLOR,
    strokeWidth: Math.min(2, radius / 2),
    opacity: 1
  })
  if (!model.compact)
    addChartText(
      model,
      '',
      { x: 8, y: cy + radius + 6, width: width - 16, align: 'center' },
      'empty'
    )
}

export function buildCircularChart(config: ChartModuleConfigV1, model: ChartLayout): void {
  const total = config.values.reduce((sum, value) => sum + value, 0)
  if (!total) {
    emptyCircularChart(model)
    return
  }
  const { width, height } = model
  const inset = Math.min(16, width * 0.08, height * 0.08)
  const wide = width >= 300 && height >= 140
  const rowSpace = wide ? height - inset * 2 : Math.min(80, height * 0.3)
  const maxRows = model.compact ? 0 : Math.max(0, Math.floor(rowSpace / 20) - 1)
  const rows = Math.min(maxRows, config.labels.length)
  model.hiddenLabelCount = config.labels.length - rows
  const legendWidth = wide ? Math.min(150, width * 0.42) : width - inset * 2
  const legendHeight = rows * 20 + (model.hiddenLabelCount && !model.compact ? 20 : 0)
  const diskWidth = wide ? width - inset * 3 - legendWidth : width - inset * 2
  const diskHeight = wide ? height - inset * 2 : height - inset * 2 - legendHeight
  const radius = chartNumber(Math.max(0, Math.min(diskWidth, diskHeight) / 2 - 2))
  const cx = chartNumber(inset + diskWidth / 2),
    cy = chartNumber(inset + diskHeight / 2)
  if (radius <= 0) {
    model.compact = true
    model.hiddenLabelCount = config.labels.length
    return
  }
  const inner = config.chartType === 'donut' ? chartNumber(radius * 0.58) : 0
  let angle = -Math.PI / 2
  const colors = config.values.map((_, i) =>
    i ? CHART_PALETTE[(i - 1) % CHART_PALETTE.length] : config.color
  )
  config.values.forEach((value, index) => {
    if (!value) return
    const end = angle + (value / total) * Math.PI * 2
    model.paths.push({
      d: slicePath(cx, cy, radius, inner, angle, end),
      fill: colors[index],
      stroke: '#FFFFFF',
      strokeWidth: Math.min(1.5, radius / 4),
      opacity: 1
    })
    angle = end
  })
  const legendX = wide ? width - inset - legendWidth : inset
  const legendY = wide
    ? Math.max(inset, (height - legendHeight) / 2)
    : height - inset - legendHeight
  for (let i = 0; i < rows; i++) {
    const y = legendY + i * 20
    model.circles.push({
      x: legendX + 4,
      y: y + 9,
      radius: 3.5,
      fill: colors[i],
      stroke: 'none',
      strokeWidth: 0,
      opacity: 1
    })
    const label = config.labels[i] + (config.showValues ? ` · ${config.values[i]}` : '')
    addChartText(model, label, { x: legendX + 14, y, width: legendWidth - 14, align: 'left' })
  }
  if (!model.compact) addHiddenChartLabels(model, legendX, legendY + rows * 20, legendWidth)
}
