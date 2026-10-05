import { describe, expect, test } from 'bun:test'

import {
  MOTION_LIMITS,
  cloneMotionSpec,
  getMotionChannels,
  parseMotionSpec,
  validateMotionSpec,
  type MotionKeyframe,
  type MotionSpec
} from '@open-pencil/scene-graph'

const red = { r: 1, g: 0, b: 0, a: 1 }
const blue = { r: 0, g: 0, b: 1, a: 0.5 }

const advancedValues = {
  opacity: [0, 1],
  color: [red, blue],
  paintOpacity: [0.2, 0.8],
  strokeOpacity: [0.4, 1],
  stopPosition: [0.1, 0.4],
  blurRadius: [0, 12],
  shadowX: [0, 10],
  shadowY: [2, 12],
  shadowBlur: [4, 20],
  shadowSpread: [0, 4],
  corners: [
    { topLeft: 0, topRight: 2, bottomRight: 4, bottomLeft: 6 },
    { topLeft: 10, topRight: 12, bottomRight: 14, bottomLeft: 16 }
  ],
  textReveal: [0, 1],
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

function advancedFrame(offset: 0 | 1): MotionKeyframe {
  return {
    offset,
    opacity: advancedValues.opacity[offset],
    paints: [
      {
        kind: 'fill',
        index: 0,
        color: advancedValues.color[offset],
        opacity: advancedValues.paintOpacity[offset]
      },
      { kind: 'stroke', index: 1, opacity: advancedValues.strokeOpacity[offset] }
    ],
    gradientStops: [
      {
        kind: 'fill',
        paintIndex: 2,
        stopIndex: 0,
        position: advancedValues.stopPosition[offset],
        color: advancedValues.color[offset]
      }
    ],
    effects: [
      { kind: 'blur', index: 0, radius: advancedValues.blurRadius[offset] },
      {
        kind: 'shadow',
        index: 1,
        x: advancedValues.shadowX[offset],
        y: advancedValues.shadowY[offset],
        blur: advancedValues.shadowBlur[offset],
        spread: advancedValues.shadowSpread[offset],
        color: advancedValues.color[offset]
      }
    ],
    cornerRadii: { ...advancedValues.corners[offset] },
    textReveal: advancedValues.textReveal[offset],
    fontAxes: [
      { tag: 'wght', value: advancedValues.weight[offset] },
      { tag: 'wdth', value: advancedValues.width[offset] }
    ],
    vectorMorph: {
      topologyId: 'glyph:triangle-v1',
      points: advancedValues.morphPoints[offset].map((point) => ({ ...point }))
    }
  }
}

function advancedV3(): MotionSpec {
  return {
    version: 3,
    tracks: [
      {
        id: 'advanced-visuals',
        trigger: 'mount',
        keyframes: [advancedFrame(0), advancedFrame(1)],
        timing: { durationMs: 1_000, easing: 'linear' },
        composition: { mode: 'replace', weight: 1, priority: 4 }
      }
    ]
  }
}

function withFrames(first: MotionKeyframe, second: MotionKeyframe): MotionSpec {
  const source = advancedV3()
  return {
    ...source,
    tracks: [{ ...source.tracks[0], keyframes: [first, second] }]
  }
}

describe('MotionSpec v3 advanced channel validation', () => {
  test('accepts, discovers, and deeply clones every structured channel', () => {
    const source = advancedV3()
    const parsed = parseMotionSpec(source)
    const copy = cloneMotionSpec(parsed)

    expect(parsed).toEqual(source)
    expect(getMotionChannels(parsed.tracks[0].keyframes)).toMatchObject({
      paints: true,
      gradientStops: true,
      effects: true,
      cornerRadii: true,
      textReveal: true,
      fontAxes: true,
      vectorMorph: true
    })
    expect(copy).toEqual(parsed)
    expect(copy.tracks[0].keyframes[0].paints).not.toBe(parsed.tracks[0].keyframes[0].paints)
    expect(copy.tracks[0].keyframes[0].paints?.[0]?.color).not.toBe(
      parsed.tracks[0].keyframes[0].paints?.[0]?.color
    )
    expect(copy.tracks[0].keyframes[0].gradientStops?.[0]?.color).not.toBe(
      parsed.tracks[0].keyframes[0].gradientStops?.[0]?.color
    )
    expect(copy.tracks[0].keyframes[0].effects?.[1]).not.toBe(
      parsed.tracks[0].keyframes[0].effects?.[1]
    )
    expect(copy.tracks[0].keyframes[0].cornerRadii).not.toBe(
      parsed.tracks[0].keyframes[0].cornerRadii
    )
    expect(copy.tracks[0].keyframes[0].fontAxes?.[0]).not.toBe(
      parsed.tracks[0].keyframes[0].fontAxes?.[0]
    )
    expect(copy.tracks[0].keyframes[0].vectorMorph?.points[0]).not.toBe(
      parsed.tracks[0].keyframes[0].vectorMorph?.points[0]
    )
  })

  test('keeps all structured channels v3-only and rejects unknown fields', () => {
    const source = advancedV3()
    expect(validateMotionSpec({ ...source, version: 1 }).success).toBe(false)
    expect(validateMotionSpec({ ...source, version: 2 }).success).toBe(false)
    expect(
      validateMotionSpec({
        ...source,
        tracks: [
          {
            ...source.tracks[0],
            keyframes: [
              { ...source.tracks[0].keyframes[0], unsupportedAdvancedChannel: true },
              source.tracks[0].keyframes[1]
            ]
          }
        ]
      }).success
    ).toBe(false)
  })

  test('fails closed on duplicate or changing indexed target topology', () => {
    const first = advancedFrame(0)
    const second = advancedFrame(1)
    const duplicatePaints = [first.paints?.[0], first.paints?.[0]].filter(
      (target): target is NonNullable<typeof target> => target !== undefined
    )
    const duplicateStops = [first.gradientStops?.[0], first.gradientStops?.[0]].filter(
      (target): target is NonNullable<typeof target> => target !== undefined
    )
    const duplicateEffects = [first.effects?.[0], first.effects?.[0]].filter(
      (target): target is NonNullable<typeof target> => target !== undefined
    )
    const duplicateAxes = [
      { tag: 'wght', value: 100 },
      { tag: 'wght', value: 200 }
    ]

    for (const candidate of [
      withFrames({ ...first, paints: duplicatePaints }, second),
      withFrames({ ...first, gradientStops: duplicateStops }, second),
      withFrames({ ...first, effects: duplicateEffects }, second),
      withFrames({ ...first, fontAxes: duplicateAxes }, second),
      withFrames(first, {
        ...second,
        paints: second.paints?.map((target, index) =>
          index === 0 ? { ...target, index: 3 } : target
        )
      }),
      withFrames(first, {
        ...second,
        effects: second.effects?.map((target, index) =>
          index === 0
            ? {
                kind: 'shadow' as const,
                index: target.index,
                x: 0,
                y: 0,
                blur: 1,
                spread: 0,
                color: red
              }
            : target
        )
      }),
      withFrames(first, {
        ...second,
        vectorMorph: {
          topologyId: 'different-topology',
          points: second.vectorMorph?.points ?? []
        }
      }),
      withFrames(first, {
        ...second,
        vectorMorph: {
          topologyId: second.vectorMorph?.topologyId ?? 'missing',
          points: [{ x: 0, y: 0 }]
        }
      })
    ]) {
      expect(validateMotionSpec(candidate).success).toBe(false)
    }
  })

  test('enforces normalized values, safe identifiers, indices, and resource limits', () => {
    const first = advancedFrame(0)
    const second = advancedFrame(1)
    const tooManyAxes = Array.from({ length: MOTION_LIMITS.maxFontAxes + 1 }, (_, index) => ({
      tag: `x${String(index).padStart(3, '0')}`,
      value: 0
    }))

    for (const candidate of [
      withFrames({ ...first, textReveal: -0.01 }, second),
      withFrames(
        {
          ...first,
          paints: [{ kind: 'fill', index: -1, color: red }]
        },
        second
      ),
      withFrames(
        {
          ...first,
          gradientStops: [{ kind: 'fill', paintIndex: 0, stopIndex: 0, position: 1.01, color: red }]
        },
        second
      ),
      withFrames({ ...first, fontAxes: [{ tag: '宽度', value: 100 }] }, second),
      withFrames({ ...first, fontAxes: tooManyAxes }, second),
      withFrames(
        {
          ...first,
          vectorMorph: { topologyId: '../unsafe', points: [{ x: 0, y: 0 }] }
        },
        second
      ),
      withFrames({ ...first, effects: [] }, second)
    ]) {
      expect(validateMotionSpec(candidate).success).toBe(false)
    }
  })

  test('allows advanced channels only in unweighted replace tracks', () => {
    const source = advancedV3()
    expect(validateMotionSpec(source).success).toBe(true)
    for (const composition of [
      { mode: 'replace' as const, weight: 0.5 },
      { mode: 'add' as const, weight: 1 },
      { mode: 'accumulate' as const, weight: 1 }
    ]) {
      expect(
        validateMotionSpec({
          ...source,
          tracks: [{ ...source.tracks[0], composition }]
        }).success
      ).toBe(false)
    }
  })
})
