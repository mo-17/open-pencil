import { expect, test } from 'bun:test'

import { createChartModuleInstance, resolveChartModule } from '#core/plugins/chart'

test('Chart preserves the exact five-field v1 bar config and accepts five reviewed types', () => {
  for (const chartType of ['bar', 'line', 'area', 'pie', 'donut']) {
    const instance = createChartModuleInstance({ chartType, values: [0, 2], labels: ['中文', 'B'] })
    expect(instance.configVersion).toBe(1)
    expect(Object.keys(instance.config).sort()).toEqual([
      'chartType',
      'color',
      'labels',
      'showValues',
      'values'
    ])
    expect(resolveChartModule(instance)?.ok).toBe(true)
  }
})

test('Chart rejects negative circular values, unknown fields, accessors and oversized data', () => {
  for (const chartType of ['bar', 'line', 'area'])
    expect(
      resolveChartModule(createChartModuleInstance({ chartType, values: [-3], labels: ['损益'] }))
        ?.ok
    ).toBe(true)
  for (const chartType of ['pie', 'donut'])
    expect(() => createChartModuleInstance({ chartType, values: [-1], labels: ['A'] })).toThrow()
  expect(() =>
    createChartModuleInstance({
      values: Array.from({ length: 65 }, () => 1),
      labels: Array.from({ length: 65 }, () => 'A')
    })
  ).toThrow()
  expect(() => createChartModuleInstance({ chartType: 'radar' })).toThrow()
  expect(() => createChartModuleInstance({ url: 'https://example.com' })).toThrow()
  let reads = 0
  const draft = Object.defineProperty({}, 'values', {
    enumerable: true,
    get() {
      reads++
      return [1]
    }
  })
  expect(() => createChartModuleInstance(draft)).toThrow()
  expect(reads).toBe(0)
})
