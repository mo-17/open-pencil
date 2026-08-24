import { describe, expect, test } from 'bun:test'

import {
  cloneMotionSpec,
  getMotionChannels,
  parseMotionSpec,
  validateMotionSpec,
  type MotionSpec
} from '@open-pencil/scene-graph'

function v2(): MotionSpec {
  return {
    version: 2,
    tracks: [
      {
        id: 'advanced',
        trigger: 'mount',
        path: {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 50 }
          ],
          autoRotate: true
        },
        keyframes: [
          {
            offset: 0,
            originX: 0,
            originY: 0,
            width: 100,
            height: 40,
            cornerRadius: 4,
            fillColor: { r: 1, g: 0, b: 0, a: 1 },
            strokeColor: { r: 0, g: 0, b: 0, a: 1 },
            strokeWidth: 1,
            blur: 0,
            shadowX: 0,
            shadowY: 2,
            shadowBlur: 4,
            shadowSpread: 0,
            shadowColor: { r: 0, g: 0, b: 0, a: 0.25 },
            pathProgress: 0,
            trimStart: 0,
            trimEnd: 0.25,
            trimOffset: 0,
            gap: 4,
            rowGap: 4,
            columnGap: 8,
            paddingTop: 4,
            paddingRight: 8,
            paddingBottom: 4,
            paddingLeft: 8,
            easing: { type: 'spring', mass: 1, stiffness: 100, damping: 20, velocity: 0 }
          },
          {
            offset: 1,
            originX: 0.5,
            originY: 0.5,
            width: 200,
            height: 80,
            cornerRadius: 20,
            fillColor: { r: 0, g: 0, b: 1, a: 0.5 },
            strokeColor: { r: 1, g: 1, b: 1, a: 1 },
            strokeWidth: 4,
            blur: 8,
            shadowX: 10,
            shadowY: 12,
            shadowBlur: 20,
            shadowSpread: 2,
            shadowColor: { r: 0.2, g: 0.3, b: 0.4, a: 0.5 },
            pathProgress: 1,
            trimStart: 0.25,
            trimEnd: 1,
            trimOffset: 0.5,
            gap: 12,
            rowGap: 16,
            columnGap: 20,
            paddingTop: 12,
            paddingRight: 16,
            paddingBottom: 20,
            paddingLeft: 24
          }
        ],
        timing: {
          durationMs: 800,
          easing: { type: 'steps', steps: 4, position: 'end' }
        }
      }
    ]
  }
}

describe('MotionSpec v2 validation', () => {
  test('accepts bounded advanced channels, paths, and physical easing', () => {
    const source = v2()
    const parsed = parseMotionSpec(source)
    expect(parsed).toEqual(source)
    expect(getMotionChannels(parsed.tracks[0].keyframes)).toEqual({
      opacity: false,
      translate: false,
      scale: false,
      rotate: false,
      origin: true,
      width: true,
      height: true,
      cornerRadius: true,
      fillColor: true,
      strokeColor: true,
      strokeWidth: true,
      blur: true,
      shadow: true,
      path: true,
      trim: true,
      gap: true,
      rowGap: true,
      columnGap: true,
      padding: true
    })
  })

  test('deep clones v2 colors, paths, and easing objects', () => {
    const source = v2()
    source.tracks[0].keyframes[0].easing = {
      type: 'back',
      mode: 'out',
      overshoot: 1.70158
    }
    source.tracks[0].timing.easing = {
      type: 'elastic',
      mode: 'inOut',
      amplitude: 1.25,
      period: 0.4
    }
    const copy = cloneMotionSpec(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.tracks[0].path).not.toBe(source.tracks[0].path)
    expect(copy.tracks[0].path?.points[0]).not.toBe(source.tracks[0].path?.points[0])
    expect(copy.tracks[0].keyframes[0].fillColor).not.toBe(source.tracks[0].keyframes[0].fillColor)
    expect(copy.tracks[0].keyframes[0].easing).not.toBe(source.tracks[0].keyframes[0].easing)
    expect(copy.tracks[0].timing.easing).not.toBe(source.tracks[0].timing.easing)
  })

  test('keeps v1 strict and rejects partial, unsafe, or unpaired v2 channels', () => {
    const valid = v2()
    const first = valid.tracks[0].keyframes[0]
    const second = valid.tracks[0].keyframes[1]
    const invalid: unknown[] = [
      { ...valid, version: 1 },
      { ...valid, version: 4 },
      {
        ...valid,
        tracks: [{ ...valid.tracks[0], path: undefined }]
      },
      {
        ...valid,
        tracks: [
          {
            ...valid.tracks[0],
            keyframes: [{ ...first }, { ...second, width: undefined }]
          }
        ]
      },
      {
        ...valid,
        tracks: [
          {
            ...valid.tracks[0],
            path: { points: [{ x: 0, y: 0 }] }
          }
        ]
      },
      {
        ...valid,
        tracks: [
          {
            ...valid.tracks[0],
            keyframes: [{ ...first, fillColor: { r: 2, g: 0, b: 0, a: 1 } }, second]
          }
        ]
      }
    ]
    for (const candidate of invalid) expect(validateMotionSpec(candidate).success).toBe(false)
  })

  test('accepts all v2/v3 easing families and rejects malformed parameters', () => {
    for (const easing of [
      { type: 'hold' },
      { type: 'steps', steps: 8, position: 'start' },
      { type: 'spring', mass: 1, stiffness: 170, damping: 26, velocity: 0 },
      { type: 'inertia', velocity: 20, deceleration: 0.2 },
      { type: 'power', mode: 'in', power: 1 },
      { type: 'power', mode: 'out', power: 4 },
      { type: 'sine', mode: 'inOut' },
      { type: 'expo', mode: 'in' },
      { type: 'circ', mode: 'out' },
      { type: 'back', mode: 'inOut', overshoot: 10 },
      { type: 'bounce', mode: 'out' },
      { type: 'elastic', mode: 'in', amplitude: 1, period: 0.1 },
      { type: 'elastic', mode: 'inOut', amplitude: 10, period: 2 }
    ]) {
      for (const version of [2, 3] as const) {
        const source = v2()
        source.version = version
        source.tracks[0].timing.easing = easing as never
        expect(validateMotionSpec(source).success).toBe(true)
      }
    }

    const keyframeSource = v2()
    keyframeSource.tracks[0].keyframes[0].easing = { type: 'bounce', mode: 'out' }
    expect(parseMotionSpec(keyframeSource)).toEqual(keyframeSource)

    const invalidEasings: unknown[] = [
      { type: 'steps', steps: 0, position: 'end' },
      { type: 'power', mode: 'sideways', power: 2 },
      { type: 'power', mode: 'in', power: 0 },
      { type: 'power', mode: 'in', power: 2.5 },
      { type: 'power', mode: 'in', power: 5 },
      { type: 'sine' },
      { type: 'sine', mode: 'in', power: 2 },
      { type: 'back', mode: 'out' },
      { type: 'back', mode: 'out', overshoot: -0.01 },
      { type: 'back', mode: 'out', overshoot: 10.01 },
      { type: 'elastic', mode: 'inOut', amplitude: 0.99, period: 0.4 },
      { type: 'elastic', mode: 'inOut', amplitude: 10.01, period: 0.4 },
      { type: 'elastic', mode: 'inOut', amplitude: 1, period: 0.09 },
      { type: 'elastic', mode: 'inOut', amplitude: 1, period: 2.01 },
      { type: 'elastic', mode: 'inOut', amplitude: 1, period: 0.4, overshoot: 1 }
    ]
    for (const easing of invalidEasings) {
      const source = v2()
      source.tracks[0].timing.easing = easing as never
      expect(validateMotionSpec(source).success).toBe(false)
    }

    const v1WithRichEasing: unknown = {
      version: 1,
      tracks: [
        {
          id: 'move',
          trigger: 'mount',
          keyframes: [
            { offset: 0, x: 0 },
            { offset: 1, x: 100 }
          ],
          timing: {
            durationMs: 100,
            easing: { type: 'power', mode: 'in', power: 2 }
          }
        }
      ]
    }
    expect(validateMotionSpec(v1WithRichEasing).success).toBe(false)
  })
})
