import { describe, expect, test } from 'bun:test'

import { generatedEffectHash, sampleGeneratedEffect } from '@open-pencil/core/motion'

import { generatedEffect } from '#tests/helpers/generated-effect'

describe('generated-effect deterministic sampler', () => {
  test('is byte-for-byte stable for the same seed/time and changes only at bounded frames', () => {
    const spec = generatedEffect('noise')
    const first = sampleGeneratedEffect(spec, 400)
    const same = sampleGeneratedEffect(spec, 400)
    const sameBucket = sampleGeneratedEffect(spec, 410)
    const nextBucket = sampleGeneratedEffect(spec, 600)
    expect(JSON.stringify(first)).toBe(JSON.stringify(same))
    expect(sameBucket.primitives).toEqual(first.primitives)
    expect(nextBucket.primitives).not.toEqual(first.primitives)
    expect(generatedEffectHash(42, 3, 7)).toBe(generatedEffectHash(42, 3, 7))
    expect(generatedEffectHash(43, 3, 7)).not.toBe(generatedEffectHash(42, 3, 7))
  })

  test('honors static/disabled reduced motion and authored unsupported fallbacks', () => {
    const spec = generatedEffect('particles')
    const reducedA = sampleGeneratedEffect(spec, 0, { prefersReducedMotion: true })
    const reducedB = sampleGeneratedEffect(spec, 5_000, { prefersReducedMotion: true })
    expect(reducedA.status).toBe('static')
    expect(reducedB).toEqual(reducedA)

    const disabled = {
      ...spec,
      reducedMotion: { mode: 'disable' as const }
    }
    expect(sampleGeneratedEffect(disabled, 200, { prefersReducedMotion: true }).status).toBe(
      'disabled'
    )

    const fallbackA = sampleGeneratedEffect(spec, 0, { supported: false })
    const fallbackB = sampleGeneratedEffect(spec, 9_000, { supported: false })
    expect(fallbackA.status).toBe('static')
    expect(fallbackB).toEqual(fallbackA)
    expect(
      sampleGeneratedEffect({ ...spec, fallback: { kind: 'none' as const } }, 100, {
        supported: false
      }).status
    ).toBe('disabled')
  })

  test('fails closed for malformed/future data and never exceeds the authored budget', () => {
    expect(sampleGeneratedEffect({ ...generatedEffect(), version: 99 }, 0)).toMatchObject({
      status: 'invalid',
      primitives: []
    })
    const spec = generatedEffect('particles')
    spec.params.count = 10
    spec.budget.maxPrimitives = 10
    expect(sampleGeneratedEffect(spec, 1_000).primitives).toHaveLength(10)
  })
})
