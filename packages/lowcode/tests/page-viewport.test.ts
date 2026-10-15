import { describe, expect, test } from 'bun:test'

import { validateLowcodePageViewport } from '../src/page-viewport'

describe('page viewport v1 policy', () => {
  test('copies each supported explicit mode into a canonical data contract', () => {
    for (const mode of ['responsive', 'fit-width', 'fixed'] as const) {
      const source = { version: 1 as const, mode }
      const result = validateLowcodePageViewport(source)
      expect(result).toEqual({ ok: true, value: source })
      if (result.ok) expect(result.value).not.toBe(source)
    }
  })

  test('rejects missing, malformed, extended and future contracts', () => {
    for (const value of [
      undefined,
      null,
      [],
      'responsive',
      {},
      { mode: 'fixed' },
      { version: 2, mode: 'fixed' },
      { version: 1, mode: 'cover' },
      { version: 1, mode: 'fixed', width: 360 },
      { version: 1, mode: 'fixed', [Symbol('extra')]: true }
    ]) {
      expect(validateLowcodePageViewport(value).ok).toBe(false)
    }
  })

  test('does not evaluate accessor policy data or inherited fields', () => {
    let reads = 0
    const accessor = {
      version: 1,
      get mode() {
        reads++
        return 'responsive'
      }
    }
    expect(validateLowcodePageViewport(accessor).ok).toBe(false)
    expect(reads).toBe(0)
    expect(validateLowcodePageViewport(Object.create({ version: 1, mode: 'fixed' })).ok).toBe(false)
  })
})
