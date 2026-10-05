import { describe, expect, test } from 'bun:test'

import {
  cloneMotionSpec,
  parseMotionSpec,
  resolveMotionTrackComposition,
  upgradeMotionSpecV2,
  upgradeMotionSpecV3,
  validateMotionSpec,
  type MotionSpec
} from '@open-pencil/scene-graph'

function composableV3(): MotionSpec {
  return {
    version: 3,
    tracks: [
      {
        id: 'entrance',
        name: '入场合成',
        trigger: 'mount',
        keyframes: [
          { offset: 0, opacity: 0, x: -24, scaleX: 0.8, scaleY: 0.8, rotate: -8 },
          { offset: 1, opacity: 1, x: 0, scaleX: 1, scaleY: 1, rotate: 0 }
        ],
        timing: {
          durationMs: 500,
          easing: { type: 'spring', mass: 1, stiffness: 170, damping: 26, velocity: 0 }
        },
        composition: { mode: 'accumulate', weight: 0.75, priority: -2 }
      }
    ]
  }
}

function advancedV3(composition?: {
  mode: 'replace' | 'add' | 'accumulate'
  weight?: number
  priority?: number
}): MotionSpec {
  return {
    version: 3,
    tracks: [
      {
        id: 'geometry',
        trigger: 'mount',
        keyframes: [
          { offset: 0, width: 100, fillColor: { r: 1, g: 0, b: 0, a: 1 } },
          { offset: 1, width: 200, fillColor: { r: 0, g: 0, b: 1, a: 1 } }
        ],
        timing: { durationMs: 400, easing: { type: 'steps', steps: 4, position: 'end' } },
        ...(composition ? { composition } : {})
      }
    ]
  }
}

describe('MotionSpec v3 validation', () => {
  test('accepts named composable tracks and inherits every v2 easing capability', () => {
    const source = composableV3()
    expect(parseMotionSpec(source)).toEqual(source)
  })

  test('resolves backward-compatible composition defaults', () => {
    expect(resolveMotionTrackComposition({})).toEqual({ mode: 'replace', weight: 1, priority: 0 })
    expect(
      resolveMotionTrackComposition({
        composition: { mode: 'add', weight: 0.25, priority: 7 }
      })
    ).toEqual({ mode: 'add', weight: 0.25, priority: 7 })
    expect(resolveMotionTrackComposition({ composition: { mode: 'accumulate' } })).toEqual({
      mode: 'accumulate',
      weight: 1,
      priority: 0
    })
  })

  test('deep clones composition metadata', () => {
    const source = composableV3()
    const copy = cloneMotionSpec(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.tracks[0]?.composition).not.toBe(source.tracks[0]?.composition)
  })

  test('upgrades v1 and v2 without changing behavior and never downgrades v3', () => {
    const v1: MotionSpec = {
      version: 1,
      tracks: [
        {
          id: 'fade',
          trigger: 'mount',
          keyframes: [
            { offset: 0, opacity: 0 },
            { offset: 1, opacity: 1 }
          ],
          timing: { durationMs: 300 }
        }
      ]
    }
    const v2 = upgradeMotionSpecV2(v1)
    expect(upgradeMotionSpecV3(v1)).toEqual({ ...v1, version: 3 })
    expect(upgradeMotionSpecV3(v2)).toEqual({ ...v2, version: 3 })

    const v3 = composableV3()
    expect(upgradeMotionSpecV2(v3)).toEqual(v3)
    expect(upgradeMotionSpecV2(v3).version).toBe(3)
    expect(upgradeMotionSpecV3(v3)).toEqual(v3)
  })

  test('keeps v1 and v2 track envelopes strict', () => {
    const source = composableV3()
    expect(validateMotionSpec({ ...source, version: 1 }).success).toBe(false)
    expect(validateMotionSpec({ ...source, version: 2 }).success).toBe(false)
  })

  test('rejects malformed names and composition bounds', () => {
    const source = composableV3()
    const track = source.tracks[0]
    if (!track) throw new Error('Expected MotionSpec v3 track')

    for (const candidate of [
      { ...track, name: '' },
      { ...track, name: 'x'.repeat(129) },
      { ...track, name: 'bad\u0000name' },
      { ...track, composition: { mode: 'unknown' } },
      { ...track, composition: { mode: 'add', weight: -0.01 } },
      { ...track, composition: { mode: 'add', weight: 1.01 } },
      { ...track, composition: { mode: 'add', priority: 1.5 } },
      { ...track, composition: { mode: 'add', priority: 1_001 } }
    ]) {
      expect(validateMotionSpec({ ...source, tracks: [candidate] }).success).toBe(false)
    }
  })

  test('allows advanced channels only with normalized replace composition', () => {
    expect(validateMotionSpec(advancedV3()).success).toBe(true)
    expect(
      validateMotionSpec(advancedV3({ mode: 'replace', weight: 1, priority: 9 })).success
    ).toBe(true)

    for (const composition of [
      { mode: 'replace' as const, weight: 0.5 },
      { mode: 'add' as const },
      { mode: 'accumulate' as const }
    ]) {
      expect(validateMotionSpec(advancedV3(composition)).success).toBe(false)
    }
  })
})
