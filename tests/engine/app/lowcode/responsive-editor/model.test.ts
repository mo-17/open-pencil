import { describe, expect, test } from 'bun:test'

import type { ResponsiveOverrides } from '@open-pencil/scene-graph'

import {
  RESPONSIVE_NUMBER_LIMITS,
  RESPONSIVE_NUMERIC_FIELDS,
  RESPONSIVE_PREVIEW_WIDTHS,
  responsiveClearBreakpoint,
  responsiveFieldState,
  responsiveNumberValid,
  responsiveSetField
} from '@/app/lowcode/responsive-editor/model'

describe('responsive editor branch inheritance', () => {
  test('reports the last authored min-width field while retaining earlier independent fields', () => {
    const node = {
      itemSpacing: 8,
      paddingLeft: 0,
      responsiveOverrides: {
        compact: { itemSpacing: 16, paddingLeft: 4 },
        sm: { itemSpacing: 12 },
        md: { paddingLeft: 24 },
        xl: { itemSpacing: 32 }
      }
    } as const
    expect(responsiveFieldState(node, 'sm', 'itemSpacing')).toEqual({
      value: 12,
      source: 'sm',
      overridden: true
    })
    expect(responsiveFieldState(node, 'lg', 'itemSpacing')).toEqual({
      value: 12,
      source: 'sm',
      overridden: false
    })
    expect(responsiveFieldState(node, 'lg', 'paddingLeft')).toEqual({
      value: 24,
      source: 'md',
      overridden: false
    })
    expect(responsiveFieldState(node, 'xl', 'itemSpacing')).toEqual({
      value: 32,
      source: 'xl',
      overridden: true
    })
    expect(responsiveFieldState(node, 'sm', 'paddingLeft')).toEqual({
      value: 0,
      source: 'base',
      overridden: false
    })
  })

  test('compact inherits only base, without presenting overlapping min-width values as its branch', () => {
    const node = {
      itemSpacing: 8,
      paddingLeft: 0,
      responsiveOverrides: {
        sm: { paddingLeft: 16 },
        md: { itemSpacing: 24 },
        compact: { itemSpacing: 12 }
      }
    }
    expect(responsiveFieldState(node, 'compact', 'itemSpacing')).toEqual({
      value: 12,
      source: 'compact',
      overridden: true
    })
    expect(responsiveFieldState(node, 'compact', 'paddingLeft')).toEqual({
      value: 0,
      source: 'base',
      overridden: false
    })
    expect(responsiveFieldState(node, 'md', 'itemSpacing')).toEqual({
      value: 24,
      source: 'md',
      overridden: true
    })
  })

  test('counts zero, false, null and base-equal values as explicit branch overrides', () => {
    const node = {
      itemSpacing: 0,
      visible: true,
      lineHeight: 24,
      maxWidth: 300,
      responsiveOverrides: {
        sm: { itemSpacing: 0, visible: false, lineHeight: null, maxWidth: null }
      }
    }
    for (const key of ['itemSpacing', 'visible', 'lineHeight', 'maxWidth'] as const) {
      const state = responsiveFieldState(node, 'sm', key)
      expect(state.source).toBe('sm')
      expect(state.overridden).toBe(true)
      expect(responsiveFieldState(node, 'md', key)).toEqual({ ...state, overridden: false })
    }
    expect(responsiveFieldState(node, 'sm', 'visible').value).toBe(false)
    expect(responsiveFieldState(node, 'sm', 'lineHeight').value).toBeNull()
  })

  test('ignores inherited prototype fields and explicit undefined when identifying authored sources', () => {
    const inherited = Object.create({ itemSpacing: 99 }) as { itemSpacing?: number }
    const node = {
      itemSpacing: 8,
      responsiveOverrides: { sm: inherited, md: { itemSpacing: undefined } }
    }
    expect(responsiveFieldState(node, 'lg', 'itemSpacing')).toEqual({
      value: 8,
      source: 'base',
      overridden: false
    })
    expect(responsiveFieldState({}, 'compact', 'maxHeight')).toEqual({
      value: undefined,
      source: 'base',
      overridden: false
    })
  })

  test('reads the branch axis properties without falsely projecting child positioning or width sizing', () => {
    const node = {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'FIXED',
      responsiveOverrides: { md: { layoutMode: 'VERTICAL' } }
    } as const
    expect(responsiveFieldState(node, 'md', 'layoutMode').source).toBe('md')
    expect(responsiveFieldState(node, 'md', 'primaryAxisSizing')).toEqual({
      value: 'HUG',
      source: 'base',
      overridden: false
    })
  })
})

describe('responsive editor field mutations', () => {
  test('updates only one branch and preserves unknown breakpoints and fields without mutating input', () => {
    const future = { custom: { mode: 'keep' } }
    const overrides = {
      compact: { width: 300, futureLayout: future },
      md: { width: 640 },
      futureBreakpoint: future
    } as ResponsiveOverrides & { futureBreakpoint: unknown }
    const original = structuredClone(overrides)
    const next = responsiveSetField(overrides, 'compact', 'height', 440)
    expect(next).toEqual({ ...overrides, compact: { ...overrides.compact, height: 440 } })
    expect(next).not.toBe(overrides)
    expect(next.compact).not.toBe(overrides.compact)
    expect(next.md).toBe(overrides.md)
    expect(next).toHaveProperty('futureBreakpoint', future)
    expect(next.compact).toHaveProperty('futureLayout', future)
    expect(overrides).toEqual(original)
  })

  test('restores one field to inheritance and deletes only its now-empty branch', () => {
    const overrides = {
      compact: { width: 300, height: 440 },
      sm: { width: 640 },
      lg: {}
    }
    const next = responsiveSetField(overrides, 'compact', 'width', undefined)
    expect(next.compact).toEqual({ height: 440 })
    expect(
      responsiveFieldState({ width: 1200, responsiveOverrides: next }, 'compact', 'width')
    ).toEqual({
      value: 1200,
      source: 'base',
      overridden: false
    })
    const cleared = responsiveSetField(next, 'compact', 'height', undefined)
    expect(Object.hasOwn(cleared, 'compact')).toBe(false)
    expect(cleared.sm).toEqual({ width: 640 })
    expect(Object.hasOwn(cleared, 'lg')).toBe(true)
    expect(overrides.compact).toEqual({ width: 300, height: 440 })
  })

  test('retains explicit null resets, zeros and false instead of pruning them as empty values', () => {
    const constraints = responsiveSetField(undefined, 'md', 'minWidth', null)
    const visible = responsiveSetField(constraints, 'md', 'visible', false)
    const next = responsiveSetField(visible, 'md', 'itemSpacing', 0)
    expect(next).toEqual({ md: { minWidth: null, visible: false, itemSpacing: 0 } })
    expect(responsiveSetField(next, 'md', 'lineHeight', null).md?.lineHeight).toBeNull()
    expect(responsiveSetField(undefined, 'sm', 'height', undefined)).toEqual({})
  })

  test('does not prune unknown fields when removing the last recognized field', () => {
    const overrides = { md: { width: 640, futureSizing: null } } as ResponsiveOverrides
    expect<unknown>(responsiveSetField(overrides, 'md', 'width', undefined)).toEqual({
      md: { futureSizing: null }
    })
  })

  test('clears one entire breakpoint while preserving unrelated and unknown branches', () => {
    const overrides = {
      compact: { width: 300 },
      sm: { width: 640 },
      futureBreakpoint: { preserve: true }
    } as ResponsiveOverrides
    expect<unknown>(responsiveClearBreakpoint(overrides, 'compact')).toEqual({
      sm: { width: 640 },
      futureBreakpoint: { preserve: true }
    })
    expect(responsiveClearBreakpoint(undefined, 'xl')).toEqual({})
    expect(overrides.compact).toEqual({ width: 300 })
  })
})

describe('responsive editor numeric input and preview widths', () => {
  test('provides all existing numeric fields and the exact min-width boundaries', () => {
    expect(RESPONSIVE_NUMERIC_FIELDS).toHaveLength(19)
    expect(new Set(RESPONSIVE_NUMERIC_FIELDS).size).toBe(19)
    expect(Object.keys(RESPONSIVE_NUMBER_LIMITS)).toEqual([...RESPONSIVE_NUMERIC_FIELDS])
    expect(RESPONSIVE_PREVIEW_WIDTHS).toEqual({
      compact: 390,
      sm: 640,
      md: 768,
      lg: 1024,
      xl: 1280
    })
    expect(RESPONSIVE_PREVIEW_WIDTHS.compact).toBeLessThan(640)
  })

  test('rejects nonfinite or nonnumeric inputs for every numeric field', () => {
    for (const key of RESPONSIVE_NUMERIC_FIELDS) {
      for (const value of [Number.NaN, Infinity, -Infinity, '12', null, undefined, true]) {
        expect(responsiveNumberValid(key, value)).toBe(false)
      }
      expect(responsiveNumberValid(key, 0.5)).toBe(true)
    }
  })

  test('allows negative coordinates, requires positive fonts and accepts zero line-height', () => {
    for (const key of RESPONSIVE_NUMERIC_FIELDS) {
      expect(responsiveNumberValid(key, -1)).toBe(key === 'x' || key === 'y')
      expect(responsiveNumberValid(key, 0)).toBe(key !== 'fontSize')
    }
    expect(responsiveNumberValid('fontSize', 0.01)).toBe(true)
    expect(responsiveNumberValid('x', -300.5)).toBe(true)
    expect(responsiveNumberValid('lineHeight', 0)).toBe(true)
  })

  test('can display older negative saved values while declining newly entered negative gap values', () => {
    const node = { itemSpacing: 8, responsiveOverrides: { compact: { itemSpacing: -12 } } }
    expect(responsiveFieldState(node, 'compact', 'itemSpacing').value).toBe(-12)
    expect(responsiveNumberValid('itemSpacing', -12)).toBe(false)
    expect(
      responsiveSetField(node.responsiveOverrides, 'compact', 'height', 48).compact?.itemSpacing
    ).toBe(-12)
  })
})
