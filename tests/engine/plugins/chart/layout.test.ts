import { expect, test } from 'bun:test'

import {
  buildChartLayout,
  createChartModuleInstance,
  resolveChartModule,
  type ChartLayout,
  type ChartModuleConfigV1
} from '#core/plugins/chart'

function config(
  values: number[],
  chartType: ChartModuleConfigV1['chartType'],
  labels = values.map((_, i) => '项目 ' + (i + 1))
) {
  const parsed = resolveChartModule(
    createChartModuleInstance({ values, labels, chartType, showValues: true })
  )
  if (!parsed?.ok) throw new Error('Chart fixture rejected')
  return parsed.config
}
function checkBounds(model: ChartLayout) {
  const serialized = JSON.stringify(model)
  expect(JSON.parse(serialized)).toEqual(model)
  const numbers = JSON.stringify(model).match(/NaN|Infinity/)
  expect(numbers).toBeNull()
  for (const r of model.rects.concat(
    model.texts.map((v) => ({ ...v, radius: 0, fill: v.color, opacity: 1 }))
  )) {
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.x + r.width).toBeLessThanOrEqual(model.width + 0.001)
    expect(r.y + r.height).toBeLessThanOrEqual(model.height + 0.001)
  }
  for (const c of model.circles) {
    expect(c.x - c.radius - c.strokeWidth / 2).toBeGreaterThanOrEqual(-0.001)
    expect(c.y - c.radius - c.strokeWidth / 2).toBeGreaterThanOrEqual(-0.001)
    expect(c.x + c.radius + c.strokeWidth / 2).toBeLessThanOrEqual(model.width + 0.001)
    expect(c.y + c.radius + c.strokeWidth / 2).toBeLessThanOrEqual(model.height + 0.001)
  }
}

test('Chart geometry is deterministic, inert JSON across five types, single/64 points and compact bounds', () => {
  for (const type of ['bar', 'line', 'area', 'pie', 'donut'] as const)
    for (const values of [[0], [4], Array.from({ length: 64 }, (_, i) => i + 1)])
      for (const [w, h] of [
        [360, 240],
        [120, 160],
        [60, 40],
        [1, 1],
        [0, 0]
      ]) {
        const parsed = config(values, type)
        const model = buildChartLayout(parsed, w, h)
        expect(buildChartLayout(parsed, w, h)).toEqual(model)
        checkBounds(model)
      }
})

test('Negative cartesian charts share a visible zero baseline and finite signed geometry', () => {
  for (const type of ['bar', 'line', 'area'] as const) {
    const model = buildChartLayout(config([-20, 0, 40], type), 360, 240)
    checkBounds(model)
    expect(model.paths[0].d).toMatch(/^M16 [\d.]+H344$/)
    const zero = Number(model.paths[0].d.split(' ')[1].split('H')[0])
    if (type === 'bar') {
      expect(model.rects[0].y).toBe(zero)
      expect(model.rects[0].height).toBeGreaterThan(0)
      expect(model.rects[1].height).toBe(0)
      expect(model.rects[2].y + model.rects[2].height).toBeCloseTo(zero, 2)
    } else expect(model.circles.map((v) => Math.sign(v.y - zero))).toEqual([1, 0, -1])
  }
})

test('Circular charts do not manufacture all-zero slices and single values close a full round path', () => {
  for (const type of ['pie', 'donut'] as const) {
    const empty = buildChartLayout(config([0, 0], type), 360, 240)
    expect(empty.empty).toBe(true)
    expect(empty.paths).toHaveLength(0)
    expect(empty.texts.some((v) => v.kind === 'empty')).toBe(true)
    const single = buildChartLayout(config([8], type), 500, 180)
    expect(single.paths).toHaveLength(1)
    expect(single.paths[0].d.match(/A/g)?.length).toBe(type === 'pie' ? 2 : 4)
    const radii = [...single.paths[0].d.matchAll(/A([\d.]+) ([\d.]+)/g)]
    expect(radii.every((r) => r[1] === r[2])).toBe(true)
    expect(single.paths[0].d.endsWith('Z')).toBe(true)
  }
})

test('Dense and long labels explicitly show overflow while full authored names remain in the model', () => {
  const labels = Array.from({ length: 64 }, (_, i) => `很长的中文标签English-${i}`)
  for (const type of ['bar', 'line', 'area', 'pie', 'donut'] as const) {
    const model = buildChartLayout(
      config(
        labels.map((_, i) => i + 1),
        type,
        labels
      ),
      360,
      240
    )
    expect(model.hiddenLabelCount).toBeGreaterThan(0)
    expect(model.texts.find((v) => v.kind === 'overflow')?.count).toBe(model.hiddenLabelCount)
    expect(
      model.texts.some(
        (v) =>
          v.kind === 'category' && v.text.endsWith('…') && v.fullText.startsWith('很长的中文标签')
      )
    ).toBe(true)
    checkBounds(model)
  }
})

test('Overflow summary never covers value labels when a narrow chart still has room to show values', () => {
  for (const type of ['bar', 'line', 'area'] as const)
    for (const values of [
      [1, 2, 3, 4, 5, 6, 7],
      [-7, -6, -5, -4, -3, -2, -1]
    ]) {
      const model = buildChartLayout(config(values, type), 360, 240)
      const overflow = model.texts.find((item) => item.kind === 'overflow')
      const valueLabels = model.texts.filter((item) => item.kind === 'value')
      expect(overflow?.text).toBe('+3')
      expect(valueLabels).toHaveLength(values.length)
      for (const value of valueLabels)
        expect(value.y).toBeGreaterThanOrEqual((overflow?.y ?? 0) + (overflow?.height ?? 0))
      checkBounds(model)
    }
})

test('Negative values stay below their geometry and above the separate category row', () => {
  for (const type of ['bar', 'line', 'area'] as const)
    for (const values of [
      [32, -12, 46, 68],
      [-4, -20, -1, -7],
      [-20, 20, -10, 30],
      [-7, -6, -5, -4, -3, -2, -1]
    ]) {
      const model = buildChartLayout(config(values, type), 360, 240)
      const categories = model.texts.filter((item) => item.kind === 'category')
      const valueLabels = model.texts.filter((item) => item.kind === 'value')
      expect(valueLabels).toHaveLength(values.length)
      for (const [index, value] of values.entries()) {
        if (value >= 0) continue
        const endpoint =
          type === 'bar'
            ? model.rects[index].y + model.rects[index].height
            : model.circles[index].y +
              model.circles[index].radius +
              model.circles[index].strokeWidth / 2
        const label = valueLabels[index]
        expect(label.y).toBeGreaterThan(endpoint)
        expect(label.y + label.height).toBeLessThanOrEqual(
          Math.min(...categories.map((item) => item.y))
        )
      }
      checkBounds(model)
    }
})

test('Short signed charts keep category and data geometry readable instead of overlapping value rows', () => {
  for (const type of ['bar', 'line', 'area'] as const) {
    const model = buildChartLayout(config([32, -12, 46, 68], type), 360, 80)
    expect(model.texts.filter((item) => item.kind === 'category')).toHaveLength(4)
    expect(model.texts.filter((item) => item.kind === 'value')).toHaveLength(0)
    if (type === 'bar') expect(model.rects.every((rect) => rect.height > 0)).toBe(true)
    else expect(new Set(model.circles.map((circle) => circle.y)).size).toBe(4)
    checkBounds(model)
  }
})
