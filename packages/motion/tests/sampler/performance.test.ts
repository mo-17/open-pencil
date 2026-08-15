import { describe, expect, test } from 'bun:test'

import { prepareMotionSamplingPlan, samplePreparedMotionPlan } from '@open-pencil/motion'
import type { MotionSpec } from '@open-pencil/scene-graph'

function benchmarkSpec(seed: number): MotionSpec {
  return {
    version: 1,
    tracks: [
      {
        id: `track-${seed}`,
        trigger: seed % 2 === 0 ? 'mount' : 'hover',
        keyframes: [
          { offset: 0, x: 0, y: seed % 17, opacity: 0, rotate: 0 },
          { offset: 0.33, x: 20, y: 10, opacity: 0.4, rotate: 5, easing: 'ease-in' },
          { offset: 0.66, x: 60, y: -10, opacity: 0.8, rotate: -5, easing: 'ease-out' },
          { offset: 1, x: 100, y: 0, opacity: 1, rotate: 0 }
        ],
        timing: {
          durationMs: 900 + (seed % 5) * 20,
          delayMs: seed % 7,
          easing: 'linear',
          iterations: 2,
          direction: 'alternate',
          fill: 'both'
        }
      }
    ]
  }
}

function runPreparedBaseline(targetCount: number) {
  const plans = Array.from({ length: targetCount }, (_, index) =>
    prepareMotionSamplingPlan(benchmarkSpec(index), { selection: { mode: 'all' } })
  )
  let checksum = 0
  const startedAt = performance.now()
  for (let frame = 0; frame < 90; frame++) {
    const elapsedMs = frame * 16.6667
    for (const plan of plans) {
      const visual = samplePreparedMotionPlan(plan, elapsedMs).visual
      checksum += visual.x + visual.y + visual.rotate + visual.opacity
    }
  }
  return { checksum, elapsedMs: performance.now() - startedAt }
}

describe('prepared Motion sampling performance baseline', () => {
  for (const [targetCount, ceilingMs] of [
    [100, 5_000],
    [500, 15_000]
  ] as const) {
    test(`${targetCount} targets produce repeatable frame output within a coarse ceiling`, () => {
      const first = runPreparedBaseline(targetCount)
      const second = runPreparedBaseline(targetCount)

      expect(first.checksum).toBe(second.checksum)
      expect(first.checksum).toBeGreaterThan(0)
      // Deliberately seconds-wide: this catches accidental per-frame validation/analysis blowups
      // without asserting brittle microsecond throughput on shared CI machines.
      expect(Math.max(first.elapsedMs, second.elapsedMs)).toBeLessThan(ceilingMs)
    })
  }
})
