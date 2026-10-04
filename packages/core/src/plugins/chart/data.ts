import type { ChartModuleConfigV1 } from '#core/plugins/chart'

import { buildChartLayout } from './layout'
import { CHART_MODULE_LIMITS } from './limits'
import { createChartLayout } from './model'
import { addChartText } from './primitives'
import type { ChartLayout } from './types'

export interface ChartData {
  values: number[]
  labels: string[]
}

/** Bound data is a complete single series. Never read accessors or coerce values. */
export function parseChartData(
  value: unknown,
  chartType: ChartModuleConfigV1['chartType']
): ChartData | null {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== null && prototype !== Object.prototype) return null
    const keys = Reflect.ownKeys(value)
    if (keys.length !== 2 || !keys.includes('values') || !keys.includes('labels')) return null
    const values = Object.getOwnPropertyDescriptor(value, 'values')
    const labels = Object.getOwnPropertyDescriptor(value, 'labels')
    if (!values || !labels || !Object.hasOwn(values, 'value') || !Object.hasOwn(labels, 'value'))
      return null
    const numbers = dataArray(values.value, 'number')
    const names = dataArray(labels.value, 'string')
    if (!numbers || !names || numbers.length !== names.length) return null
    if ((chartType === 'pie' || chartType === 'donut') && numbers.some((entry) => entry < 0))
      return null
    return { values: numbers, labels: names }
  } catch {
    return null
  }
}

function dataArray(value: unknown, kind: 'number'): number[] | null
function dataArray(value: unknown, kind: 'string'): string[] | null
function dataArray(value: unknown, kind: 'number' | 'string'): number[] | string[] | null {
  if (!Array.isArray(value)) return null
  const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value
  if (
    typeof length !== 'number' ||
    !Number.isInteger(length) ||
    length < 0 ||
    length > CHART_MODULE_LIMITS.values ||
    Reflect.ownKeys(value).length !== length + 1
  )
    return null
  const result: (number | string)[] = []
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null
    const entry: unknown = descriptor.value
    if (kind === 'number') {
      if (
        typeof entry !== 'number' ||
        !Number.isFinite(entry) ||
        Math.abs(entry) > CHART_MODULE_LIMITS.value
      )
        return null
    } else if (typeof entry !== 'string' || entry.length > CHART_MODULE_LIMITS.label) return null
    result.push(entry)
  }
  return result as number[] | string[]
}

/** Preserve the authored layout algorithm for every non-empty bound single series. */
export function buildChartDataLayout(
  config: ChartModuleConfigV1,
  width: number,
  height: number
): ChartLayout {
  if (config.values.length) return buildChartLayout(config, width, height)
  const model = createChartLayout(width, height)
  model.empty = true
  if (!model.compact)
    addChartText(
      model,
      '',
      { x: 8, y: model.height / 2 - 9, width: model.width - 16, align: 'center' },
      'empty'
    )
  return model
}
