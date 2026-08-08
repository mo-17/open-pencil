import { describe, expect, test } from 'bun:test'

import { DEFAULT_CANVAS_PERFORMANCE_MODE } from '@open-pencil/core/canvas'

import {
  AUTOMATIC_CANVAS_PERFORMANCE_PREFERENCE,
  applyCanvasRuntimePerformanceMode,
  repairStoredCanvasPerformanceMode
} from '@/app/settings/canvas-performance'

describe('canvas performance setting', () => {
  test.each([
    AUTOMATIC_CANVAS_PERFORMANCE_PREFERENCE,
    'resource-saving',
    'balanced',
    'smooth'
  ] as const)('accepts and preserves %s', (value) => {
    const writes: string[] = []

    expect(repairStoredCanvasPerformanceMode(value, (mode) => writes.push(mode))).toBe(value)
    expect(writes).toEqual([])
  })

  test.each([undefined, null, '', 'turbo', 60, { mode: 'smooth' }])(
    'falls back and repairs invalid persisted value %#',
    (value) => {
      const writes: string[] = []

      expect(repairStoredCanvasPerformanceMode(value, (mode) => writes.push(mode))).toBe(
        DEFAULT_CANVAS_PERFORMANCE_MODE
      )
      expect(writes).toEqual([DEFAULT_CANVAS_PERFORMANCE_MODE])
    }
  )
})

describe('canvas runtime performance targets', () => {
  test.each([
    ['resource-saving', undefined, [2, 1, 2]],
    ['balanced', 16, [4, 1, 5]],
    ['smooth', undefined, [6, 1, 3]],
    ['smooth', 16, [6, 2, 3]]
  ] as const)('maps %s with %s GiB safely', (mode, deviceMemoryGiB, expected) => {
    const applied: number[] = []
    applyCanvasRuntimePerformanceMode(mode, {
      deviceMemoryGiB,
      setFontLoadConcurrency: (value) => applied.push(value),
      setFigParseWorkerConcurrency: (value) => applied.push(value),
      setLayoutTimeSliceMs: (value) => applied.push(value)
    })

    expect(applied).toEqual(expected)
  })
})
