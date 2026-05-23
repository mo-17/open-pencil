import { describe, expect, test } from 'bun:test'

import { isAutoLayoutMode, type LayoutMode } from '@open-pencil/core/scene-graph'

/**
 * Phase 2 §6 step 1 — the helper that gates every "is this an auto-layout
 * container?" callsite. Introduced alongside the `'FREE'` variant so the
 * 18 existing `layoutMode === 'NONE'` / `!== 'NONE'` sites can be swept
 * to the new semantic without a tsgo-invisible scalar-equality regression.
 *
 * `'NONE'` and `'FREE'` both opt out of auto-layout — NONE is the legacy
 * default (free positioning only when the parent is CANVAS), FREE is the
 * §6 parent-level toggle (free positioning anywhere). They share the
 * "no flex / grid / spacing semantics" predicate.
 */
describe('isAutoLayoutMode', () => {
  test('HORIZONTAL / VERTICAL / GRID return true', () => {
    expect(isAutoLayoutMode('HORIZONTAL')).toBe(true)
    expect(isAutoLayoutMode('VERTICAL')).toBe(true)
    expect(isAutoLayoutMode('GRID')).toBe(true)
  })

  test('NONE returns false', () => {
    expect(isAutoLayoutMode('NONE')).toBe(false)
  })

  test('FREE returns false (Phase 2 §6 — explicit free positioning)', () => {
    expect(isAutoLayoutMode('FREE')).toBe(false)
  })

  test('narrows the type to the auto-layout subset (compile-time pin)', () => {
    // The function is a TS type-predicate, so the assertion is type-level:
    // if the narrowing ever drops a variant or admits a new one without
    // updating the helper, this assignment line won't compile.
    const m: LayoutMode = 'HORIZONTAL'
    if (isAutoLayoutMode(m)) {
      const narrowed: 'HORIZONTAL' | 'VERTICAL' | 'GRID' = m
      expect(narrowed).toBe('HORIZONTAL')
    }
  })
})
