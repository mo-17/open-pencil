import { describe, expect, test } from 'bun:test'

import { CanvasAutoPerformanceController } from '@/app/settings/canvas-auto-performance'

function feed(
  controller: CanvasAutoPerformanceController,
  {
    start,
    count,
    interval,
    renderDuration
  }: { start: number; count: number; interval: number; renderDuration: number }
): number {
  let timestamp = start
  for (let index = 0; index < count; index++) {
    timestamp += interval
    controller.record({
      timestampMs: timestamp,
      renderDurationMs: renderDuration,
      frameIntervalMs: interval
    })
  }
  return timestamp
}

describe('automatic canvas performance controller', () => {
  test('downgrades only after sustained overloaded active frames', () => {
    const controller = new CanvasAutoPerformanceController('balanced', {
      evaluationIntervalMs: 0,
      overloadWindowMs: 100,
      recoveryWindowMs: 500,
      cooldownMs: 0,
      minSamples: 3
    })

    let timestamp = feed(controller, {
      start: 0,
      count: 3,
      interval: 16,
      renderDuration: 15
    })
    expect(controller.mode).toBe('balanced')

    timestamp = feed(controller, {
      start: timestamp,
      count: 8,
      interval: 16,
      renderDuration: 15
    })
    expect(timestamp).toBeGreaterThan(100)
    expect(controller.mode).toBe('resource-saving')
  })

  test('recovers one level only after the longer healthy window', () => {
    const controller = new CanvasAutoPerformanceController('resource-saving', {
      evaluationIntervalMs: 0,
      overloadWindowMs: 50,
      recoveryWindowMs: 160,
      cooldownMs: 0,
      minSamples: 3
    })

    let timestamp = feed(controller, {
      start: 0,
      count: 8,
      interval: 16,
      renderDuration: 3
    })
    expect(controller.mode).toBe('resource-saving')

    timestamp = feed(controller, {
      start: timestamp,
      count: 5,
      interval: 16,
      renderDuration: 3
    })
    expect(timestamp).toBeGreaterThan(160)
    expect(controller.mode).toBe('balanced')
  })

  test('can recover from resource-saving cadence when discrete effects omit frame intervals', () => {
    const controller = new CanvasAutoPerformanceController('resource-saving', {
      evaluationIntervalMs: 0,
      recoveryWindowMs: 1_000,
      cooldownMs: 0,
      minSamples: 3
    })
    let timestamp = 0
    for (let index = 0; index < 20; index++) {
      timestamp += 67
      controller.record({ timestampMs: timestamp, renderDurationMs: 2 })
    }

    expect(controller.mode).toBe('balanced')
    expect(controller.snapshot.missedFrameRatio).toBe(0)
  })

  test('estimates refresh cadence from fast intervals instead of idle or dropped gaps', () => {
    const controller = new CanvasAutoPerformanceController('balanced', {
      evaluationIntervalMs: 0,
      minSamples: 3
    })
    controller.record({ timestampMs: 10, renderDurationMs: 2 })
    controller.record({ timestampMs: 18, renderDurationMs: 2, frameIntervalMs: 8 })
    controller.record({ timestampMs: 34, renderDurationMs: 2, frameIntervalMs: 16 })
    controller.record({ timestampMs: 234, renderDurationMs: 2, frameIntervalMs: 200 })

    expect(controller.snapshot.frameBudgetMs).toBe(8)
    expect(controller.snapshot.sampleCount).toBe(4)
  })

  test('reset clears transient samples and returns to an explicit starting level', () => {
    const controller = new CanvasAutoPerformanceController('smooth', { minSamples: 1 })
    controller.record({ timestampMs: 16, renderDurationMs: 20, frameIntervalMs: 16 })

    expect(controller.reset('balanced')).toBe('balanced')
    expect(controller.snapshot).toMatchObject({ mode: 'balanced', sampleCount: 0 })
  })
})
