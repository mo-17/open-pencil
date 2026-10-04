import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import { CHART_DATA_SOURCE } from '#compiler/adapters/chart/data'
import { CHART_MATH_SOURCE } from '#compiler/adapters/chart/math'
import { CHART_CONFIG_SOURCE } from '#compiler/adapters/chart/source'

import {
  buildChartDataLayout,
  CHART_MODULE_DEFAULT_CONFIG,
  parseChartData,
  type ChartLayout,
  type ChartModuleConfigV1
} from '@open-pencil/core/plugins'

interface RuntimeConfig extends ChartModuleConfigV1 {
  layout: ChartLayout
}
interface Runtime {
  chartData: typeof parseChartData
  chartGeometry(config: RuntimeConfig, width: number, height: number): ChartLayout
  chartSnapshot(
    config: RuntimeConfig,
    data: unknown,
    bound: boolean
  ): {
    config: RuntimeConfig
    invalid: boolean
    emptyData: boolean
  }
}
const source = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(
  CHART_CONFIG_SOURCE + '\n' + CHART_MATH_SOURCE + '\n' + CHART_DATA_SOURCE
)
const runtime = runInNewContext(source + '\n({chartData,chartGeometry,chartSnapshot})', {
  Object,
  Reflect,
  Array,
  Number
}) as Runtime

function authored(config: ChartModuleConfigV1): RuntimeConfig {
  return { ...config, layout: buildChartDataLayout(config, 320, 200) }
}

test('dynamic five-type geometry exactly matches Canvas across bounded data and dimensions', () => {
  for (const chartType of ['bar', 'line', 'area', 'pie', 'donut'] as const)
    for (const showValues of [false, true])
      for (const values of [
        [],
        [0],
        [1],
        [0, 0],
        [12, 24, 36],
        Array.from({ length: 64 }, (_, i) => i)
      ])
        for (const [width, height] of [
          [0, 0],
          [30, 24],
          [80, 80],
          [160, 160],
          [320, 200],
          [640, 480],
          [Infinity, Number.NaN]
        ]) {
          const config = {
            ...CHART_MODULE_DEFAULT_CONFIG,
            chartType,
            values,
            labels: values.map((_, i) => '完整类别\n' + i + '很长的标签'),
            showValues
          }
          expect(runtime.chartGeometry(authored(config), width, height)).toEqual(
            buildChartDataLayout(config, width, height)
          )
        }
  for (const chartType of ['bar', 'line', 'area'] as const)
    for (const values of [
      [-1000000, 0, 1000000],
      [-30, -20, -10]
    ]) {
      const config = {
        ...CHART_MODULE_DEFAULT_CONFIG,
        chartType,
        values,
        labels: values.map(String),
        showValues: true
      }
      expect(runtime.chartGeometry(authored(config), 320, 200)).toEqual(
        buildChartDataLayout(config, 320, 200)
      )
    }
})

test('bound empty, invalid and repaired data cannot reuse authored marks or table values', () => {
  const config = authored({
    ...CHART_MODULE_DEFAULT_CONFIG,
    values: [10, 30],
    labels: ['Old A', 'Old B']
  })
  const before = JSON.stringify(config)
  expect(runtime.chartSnapshot(config, { values: [1], labels: ['Ignored'] }, false).config).toBe(
    config
  )
  for (const value of [
    undefined,
    null,
    'bad',
    [],
    { values: [1], labels: [] },
    { values: [Infinity], labels: ['A'] }
  ]) {
    const invalid = runtime.chartSnapshot(config, value, true)
    expect(invalid.invalid).toBe(true)
    expect(invalid.emptyData).toBe(false)
    expect(invalid.config.values).toEqual([])
    expect(invalid.config.layout.rects).toEqual([])
    expect(invalid.config.layout.paths).toEqual([])
    expect(invalid.config.layout.circles).toEqual([])
  }
  const empty = runtime.chartSnapshot(config, { values: [], labels: [] }, true)
  expect(empty.invalid).toBe(false)
  expect(empty.emptyData).toBe(true)
  expect(empty.config.layout.empty).toBe(true)
  const repaired = runtime.chartSnapshot(
    config,
    { values: [25, 50, 75], labels: ['甲', '乙', '丙'] },
    true
  )
  expect(repaired.invalid).toBe(false)
  expect(repaired.emptyData).toBe(false)
  expect(repaired.config.layout.rects).toHaveLength(3)
  expect(repaired.config.labels).toEqual(['甲', '乙', '丙'])
  expect(JSON.stringify(config)).toBe(before)
})

test('Core and generated parsers reject unbounded and accessor data without invoking getters', () => {
  let accessed = 0
  const getter = {
    get values() {
      accessed++
      return [1]
    },
    labels: ['A']
  }
  const sparseValues: number[] = []
  sparseValues.length = 1
  const sparse = { values: sparseValues, labels: ['A'] }
  const slot = [1]
  Object.defineProperty(slot, '0', {
    get() {
      accessed++
      return 1
    }
  })
  const extra = Object.assign([1], { hidden: 2 })
  const samples: unknown[] = [
    getter,
    sparse,
    { values: slot, labels: ['A'] },
    { values: extra, labels: ['A'] },
    { values: [Number.NaN], labels: ['A'] },
    { values: [1000001], labels: ['A'] },
    { values: ['1'], labels: ['A'] },
    { values: [1], labels: [1] },
    { values: [1], labels: ['x'.repeat(81)] },
    { values: Array.from({ length: 65 }, () => 1), labels: Array.from({ length: 65 }, () => 'A') },
    { values: [1], labels: ['A'], series: [] },
    Object.assign(Object.create({ inherited: true }), { values: [1], labels: ['A'] })
  ]
  for (const value of samples) {
    expect(parseChartData(value, 'bar')).toBeNull()
    expect(runtime.chartData(value, 'bar')).toBeNull()
  }
  expect(accessed).toBe(0)
  for (const chartType of ['pie', 'donut'] as const) {
    expect(parseChartData({ values: [-1], labels: ['Loss'] }, chartType)).toBeNull()
    expect(runtime.chartData({ values: [-1], labels: ['Loss'] }, chartType)).toBeNull()
  }
  for (const chartType of ['bar', 'line', 'area'] as const) {
    const input = { values: [-1000000, 1000000], labels: ['', '中'.repeat(80)] }
    const value = parseChartData(input, chartType)
    expect(value).toEqual(input)
    expect(runtime.chartData(input, chartType)).toEqual(input)
    expect(value?.values).not.toBe(input.values)
    expect(value?.labels).not.toBe(input.labels)
  }
  const value = Object.assign(Object.create(null), { values: [], labels: [] })
  expect(parseChartData(value, 'donut')).toEqual({ values: [], labels: [] })
  expect(runtime.chartData(value, 'donut')).toEqual({ values: [], labels: [] })
})
