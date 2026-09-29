import { describe, expect, test } from 'bun:test'

import {
  RATING_MODULE_DEFAULT_CONFIG,
  RATING_MODULE_DEFINITION,
  RATING_PLUGIN_ID,
  SLIDER_MODULE_DEFAULT_CONFIG,
  SLIDER_PLUGIN_ID,
  createRatingModuleInstance,
  createSliderModuleInstance
} from '@open-pencil/core/plugins'

import {
  reconcileValueControlConfig,
  valueControlNumberField,
  valueControlPropertyVisible
} from '@/app/lowcode/value-controls/properties'

describe('value control authoring dependencies', () => {
  test('shrinking slider bounds clamps both endpoints and step in one valid configuration', () => {
    const before = { ...SLIDER_MODULE_DEFAULT_CONFIG, range: true, max: 0.5 }
    const next = reconcileValueControlConfig(SLIDER_PLUGIN_ID, 'max', before)
    expect(next).toMatchObject({
      min: 0,
      max: 0.5,
      step: 0.5,
      initialValue: 0.5,
      initialEndValue: 0.5
    })
    expect(() => createSliderModuleInstance(next)).not.toThrow()
    expect(before.initialValue).toBe(30)
    expect(() => createSliderModuleInstance(before)).toThrow()
  })

  test('range mode and step changes reconcile values without allowing invalid authored bounds', () => {
    const next = reconcileValueControlConfig(SLIDER_PLUGIN_ID, 'range', {
      ...SLIDER_MODULE_DEFAULT_CONFIG,
      range: true,
      initialValue: 80,
      initialEndValue: 20
    })
    expect(next).toMatchObject({ initialValue: 80, initialEndValue: 80 })
    const stepped = reconcileValueControlConfig(SLIDER_PLUGIN_ID, 'step', {
      ...SLIDER_MODULE_DEFAULT_CONFIG,
      step: 7
    })
    expect(stepped).toMatchObject({ initialValue: 28, initialEndValue: 70 })
    const snapped = reconcileValueControlConfig(SLIDER_PLUGIN_ID, 'initialValue', {
      ...SLIDER_MODULE_DEFAULT_CONFIG,
      step: 0.1,
      initialValue: 0.45
    })
    expect(snapped.initialValue).toBe(0.5)
    const invalid = { ...SLIDER_MODULE_DEFAULT_CONFIG, min: 100 }
    expect(reconcileValueControlConfig(SLIDER_PLUGIN_ID, 'min', invalid)).toBe(invalid)
    expect(() => createSliderModuleInstance(invalid)).toThrow()
  })

  test('rating count and half-star settings adjust initial value while import remains strict', () => {
    const smaller = reconcileValueControlConfig(RATING_PLUGIN_ID, 'max', {
      ...RATING_MODULE_DEFAULT_CONFIG,
      max: 2
    })
    expect(smaller.initialValue).toBe(2)
    const full = { ...RATING_MODULE_DEFAULT_CONFIG, initialValue: 3.5 }
    expect(reconcileValueControlConfig(RATING_PLUGIN_ID, 'allowHalf', full).initialValue).toBe(4)
    expect(() => createRatingModuleInstance(full)).toThrow()
    const field = RATING_MODULE_DEFINITION.fields.find((item) => item.path[0] === 'initialValue')
    if (!field) throw new Error('Missing initial value field')
    expect(valueControlNumberField(RATING_PLUGIN_ID, field, smaller)).toMatchObject({
      min: 0,
      max: 2,
      step: 1
    })
    expect(
      valueControlNumberField(RATING_PLUGIN_ID, field, { ...smaller, allowHalf: true }).step
    ).toBe(0.5)
  })

  test('conditional settings stay hidden without changing unrelated module fields', () => {
    expect(valueControlPropertyVisible(SLIDER_PLUGIN_ID, 'initialEndValue', { range: false })).toBe(
      false
    )
    expect(valueControlPropertyVisible(RATING_PLUGIN_ID, 'clearLabel', { allowClear: false })).toBe(
      false
    )
    const other = { max: 2, initialValue: 50 }
    expect(reconcileValueControlConfig('other', 'max', other)).toBe(other)
    expect(valueControlPropertyVisible('other', 'clearLabel', other)).toBe(true)
  })
})
