import { describe, expect, test } from 'bun:test'

import {
  prepareMotionSamplingPlan,
  sampleMotionSpec,
  samplePreparedMotionPlan
} from '@open-pencil/motion'
import type { MotionKeyframe, MotionSpec } from '@open-pencil/scene-graph'

const sampleValues = {
  opacity: [0, 1],
  fillColor: [
    { r: 1, g: 0, b: 0, a: 1 },
    { r: 0, g: 0, b: 1, a: 0.5 }
  ],
  paintOpacity: [0.2, 0.8],
  strokeOpacity: [0.4, 0.8],
  stopPosition: [0.1, 0.3],
  blurRadius: [0, 10],
  shadowX: [0, 10],
  shadowY: [2, 12],
  shadowBlur: [4, 20],
  shadowSpread: [0, 4],
  shadowColor: [
    { r: 0, g: 0, b: 0, a: 0.2 },
    { r: 0.4, g: 0.6, b: 0.8, a: 0.6 }
  ],
  corners: [
    { topLeft: 0, topRight: 2, bottomRight: 4, bottomLeft: 6 },
    { topLeft: 10, topRight: 12, bottomRight: 14, bottomLeft: 16 }
  ],
  textReveal: [0.2, 0.8],
  weight: [100, 900],
  width: [50, 100],
  morphPoints: [
    [
      { x: 0, y: 0 },
      { x: 10, y: 10 }
    ],
    [
      { x: 20, y: 10 },
      { x: 30, y: 50 }
    ]
  ]
} as const

function frame(offset: 0 | 1): MotionKeyframe {
  return {
    offset,
    opacity: sampleValues.opacity[offset],
    paints: [
      {
        kind: 'fill',
        index: 0,
        color: sampleValues.fillColor[offset],
        opacity: sampleValues.paintOpacity[offset]
      },
      { kind: 'stroke', index: 1, opacity: sampleValues.strokeOpacity[offset] }
    ],
    gradientStops: [
      {
        kind: 'fill',
        paintIndex: 2,
        stopIndex: 0,
        position: sampleValues.stopPosition[offset],
        color: sampleValues.fillColor[offset]
      }
    ],
    effects: [
      { kind: 'blur', index: 0, radius: sampleValues.blurRadius[offset] },
      {
        kind: 'shadow',
        index: 1,
        x: sampleValues.shadowX[offset],
        y: sampleValues.shadowY[offset],
        blur: sampleValues.shadowBlur[offset],
        spread: sampleValues.shadowSpread[offset],
        color: sampleValues.shadowColor[offset]
      }
    ],
    cornerRadii: { ...sampleValues.corners[offset] },
    textReveal: sampleValues.textReveal[offset],
    fontAxes: [
      { tag: 'wght', value: sampleValues.weight[offset] },
      { tag: 'wdth', value: sampleValues.width[offset] }
    ],
    vectorMorph: {
      topologyId: 'shape-v1',
      points: sampleValues.morphPoints[offset].map((point) => ({ ...point }))
    }
  }
}

function spec(reducedMotion: MotionSpec['reducedMotion'] = 'allow'): MotionSpec {
  return {
    version: 3,
    reducedMotion,
    tracks: [
      {
        id: 'advanced',
        trigger: 'mount',
        keyframes: [frame(0), frame(1)],
        timing: { durationMs: 1_000, easing: 'linear' },
        composition: { mode: 'replace', weight: 1 }
      }
    ]
  }
}

describe('MotionSpec v3 advanced channel sampling', () => {
  test('interpolates all indexed and structured channels deterministically', () => {
    const visual = sampleMotionSpec(spec(), 500).visual

    expect(visual.paints).toEqual([
      { kind: 'fill', index: 0, color: { r: 0.5, g: 0, b: 0.5, a: 0.75 }, opacity: 0.5 },
      { kind: 'stroke', index: 1, opacity: 0.4 + (0.8 - 0.4) * 0.5 }
    ])
    expect(visual.gradientStops).toEqual([
      {
        kind: 'fill',
        paintIndex: 2,
        stopIndex: 0,
        position: 0.2,
        color: { r: 0.5, g: 0, b: 0.5, a: 0.75 }
      }
    ])
    expect(visual.effects).toEqual([
      { kind: 'blur', index: 0, radius: 5 },
      {
        kind: 'shadow',
        index: 1,
        x: 5,
        y: 7,
        blur: 12,
        spread: 2,
        color: { r: 0.2, g: 0.3, b: 0.4, a: 0.4 }
      }
    ])
    expect(visual.cornerRadii).toEqual({
      topLeft: 5,
      topRight: 7,
      bottomRight: 9,
      bottomLeft: 11
    })
    expect(visual.textReveal).toBe(0.5)
    expect(visual.fontAxes).toEqual([
      { tag: 'wght', value: 500 },
      { tag: 'wdth', value: 75 }
    ])
    expect(visual.vectorMorph).toEqual({
      topologyId: 'shape-v1',
      points: [
        { x: 10, y: 5 },
        { x: 20, y: 30 }
      ]
    })
  })

  test('prepares deep immutable-by-contract data and returns fresh structured samples', () => {
    const source = spec()
    const plan = prepareMotionSamplingPlan(source)
    const first = samplePreparedMotionPlan(plan, 500).visual
    const second = samplePreparedMotionPlan(plan, 500).visual

    expect(plan.tracks[0].keyframes[0]).not.toBe(source.tracks[0].keyframes[0])
    expect(plan.tracks[0].keyframes[0].paints?.[0]?.color).not.toBe(
      source.tracks[0].keyframes[0].paints?.[0]?.color
    )
    expect(first.paints).not.toBe(second.paints)
    expect(first.paints?.[0]?.color).not.toBe(second.paints?.[0]?.color)
    expect(first.vectorMorph?.points[0]).not.toBe(second.vectorMorph?.points[0])
  })

  test('reduced motion retains only the opacity channel', () => {
    const visual = sampleMotionSpec(spec('reduce'), 60, { prefersReducedMotion: true }).visual

    expect(visual.opacity).toBe(0.5)
    expect(visual.paints).toBeUndefined()
    expect(visual.gradientStops).toBeUndefined()
    expect(visual.effects).toBeUndefined()
    expect(visual.cornerRadii).toBeUndefined()
    expect(visual.textReveal).toBeUndefined()
    expect(visual.fontAxes).toBeUndefined()
    expect(visual.vectorMorph).toBeUndefined()
  })
})
