import type { ChartModuleConfigV1 } from '#core/plugins/chart'

import { addChartText, addHiddenChartLabels, CHART_AXIS_COLOR, chartNumber } from './primitives'
import type { ChartLayout } from './types'

export function buildCartesianChart(config: ChartModuleConfigV1, model: ChartLayout): void {
  const { width, height } = model
  const inset = Math.min(16, width * 0.08, height * 0.08)
  const plotWidth = width - inset * 2
  const step = plotWidth / config.values.length
  const stride = Math.max(
    1,
    Math.ceil(config.labels.length / Math.max(1, Math.floor(plotWidth / 52)))
  )
  const labelBand = model.compact ? 0 : 22
  const requestedValues = !model.compact && config.showValues && step >= 44
  const requestedOverflowBand = requestedValues && stride > 1 ? 20 : 0
  const requestedNegativeBand = requestedValues && config.values.some((value) => value < 0) ? 24 : 0
  // Each label needs its own row outside the plot; compact charts must not force them into data.
  const showValues =
    requestedValues &&
    height - inset * 2 - labelBand - 20 - requestedOverflowBand - requestedNegativeBand >= 12
  const overflowBand = showValues ? requestedOverflowBand : 0
  const negativeValueBand = showValues ? requestedNegativeBand : 0
  const topBand = model.compact ? 0 : 20 + overflowBand
  const left = inset,
    right = width - inset,
    top = inset + topBand
  const bottom = Math.max(top, height - inset - labelBand - negativeValueBand)
  const plotHeight = bottom - top
  const min = Math.min(0, ...config.values),
    max = Math.max(0, ...config.values)
  const lower = min === max ? -1 : min,
    upper = min === max ? 1 : max
  const y = (v: number) => chartNumber(top + ((upper - v) / (upper - lower)) * plotHeight)
  const x = (i: number) => chartNumber(left + step * (i + 0.5))
  const zero = y(0)
  model.paths.push({
    d: `M${chartNumber(left)} ${zero}H${chartNumber(right)}`,
    fill: 'none',
    stroke: CHART_AXIS_COLOR,
    strokeWidth: Math.min(1, inset),
    opacity: 1
  })
  if (config.chartType === 'bar') {
    const gap = Math.min(12, step * 0.24)
    config.values.forEach((value, index) =>
      model.rects.push({
        x: chartNumber(left + step * index + gap / 2),
        y: Math.min(y(value), zero),
        width: chartNumber(Math.max(0, step - gap)),
        height: chartNumber(Math.abs(y(value) - zero)),
        radius: 0,
        fill: config.color,
        opacity: 1
      })
    )
  } else {
    const line = config.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join('')
    if (config.chartType === 'area')
      model.paths.push({
        d: `${line}L${x(config.values.length - 1)} ${zero}L${x(0)} ${zero}Z`,
        fill: config.color,
        stroke: 'none',
        strokeWidth: 0,
        opacity: 0.16
      })
    model.paths.push({
      d: line,
      fill: 'none',
      stroke: config.color,
      strokeWidth: Math.min(2, inset),
      opacity: 1
    })
    config.values.forEach((value, index) =>
      model.circles.push({
        x: x(index),
        y: y(value),
        radius: Math.min(3, step / 3, plotHeight / 4, inset / 2),
        fill: config.color,
        stroke: '#FFFFFF',
        strokeWidth: Math.min(1, inset / 2),
        opacity: 1
      })
    )
  }
  if (model.compact) {
    model.hiddenLabelCount = config.labels.length
    return
  }
  let visible = 0
  for (let first = 0; first < config.labels.length; first += stride) {
    const count = Math.min(stride, config.labels.length - first)
    const index = first + Math.floor((count - 1) / 2)
    addChartText(model, config.labels[index], {
      x: left + first * step,
      y: height - inset - 18,
      width: count * step - 4,
      align: 'center'
    })
    visible++
  }
  model.hiddenLabelCount = config.labels.length - visible
  addHiddenChartLabels(model, left, inset, plotWidth)
  if (showValues)
    config.values.forEach((value, index) => {
      const labelY = value >= 0 ? Math.max(inset + overflowBand, y(value) - 20) : y(value) + 6
      addChartText(
        model,
        String(value),
        { x: x(index) - step / 2, y: labelY, width: step - 2, align: 'center' },
        'value'
      )
    })
}
