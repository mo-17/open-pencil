import { expect, test } from 'bun:test'

import {
  SLIDER_MODULE_DEFAULT_CONFIG,
  createSliderModuleFrameOverrides,
  createSliderModuleInstance,
  normalizeSliderValue,
  resolveSliderModule,
  sliderInitialValues
} from '#core/plugins/slider'

import { expectModuleInstance } from '#tests/helpers/assert'

test('Slider is a portable FRAME module with isolated default configuration', () => {
  const first = createSliderModuleInstance()
  const second = createSliderModuleInstance()
  first.config.label = 'Edited'
  expect(second.config.label).toBe('Value')
  expect(SLIDER_MODULE_DEFAULT_CONFIG.label).toBe('Value')
  const frame = createSliderModuleFrameOverrides({ label: '价格', range: true })
  expect(expectModuleInstance(frame.interactiveProps?.module).moduleType).toBe('slider')
  expect(resolveSliderModule(frame.interactiveProps?.module)?.ok).toBe(true)
})

test('Slider rejects unsupported config versions and unknown or missing fields', () => {
  const instance = createSliderModuleInstance()
  expect(resolveSliderModule({ ...instance, configVersion: 2 })?.ok).toBe(false)
  expect(
    resolveSliderModule({ ...instance, config: { ...instance.config, script: 'x' } })?.ok
  ).toBe(false)
  const { step: _step, ...missing } = instance.config
  expect(resolveSliderModule({ ...instance, config: missing })?.ok).toBe(false)
  expect(resolveSliderModule(null)).toBeNull()
  expect(resolveSliderModule({ ...instance, moduleType: 'rating' })).toBeNull()
})

test('Slider enforces finite numeric bounds and safe decimal precision', () => {
  for (const patch of [
    { min: 100 },
    { max: 0 },
    { step: 0 },
    { step: -1 },
    { step: 101 },
    { step: 0.0000001 },
    { initialValue: -1 },
    { initialEndValue: 101 },
    { min: -1_000_001 },
    { max: Infinity },
    { step: Number.NaN },
    { min: '0' },
    { range: 'true' },
    { readOnly: 1 },
    { range: true, initialValue: 80, initialEndValue: 20 },
    { accentColor: 'url(https://invalid.example/paint)' },
    { label: 'x'.repeat(121) },
    { fontSize: 80 }
  ])
    expect(() => createSliderModuleInstance(patch)).toThrow()
})

test('fractional values snap on a min-based grid without floating artifacts or overshooting max', () => {
  const config = {
    ...SLIDER_MODULE_DEFAULT_CONFIG,
    range: true,
    min: -0.3,
    max: 0.65,
    step: 0.1,
    initialValue: 0.3,
    initialEndValue: 0.65
  }
  expect(resolveSliderModule(createSliderModuleInstance(config))?.ok).toBe(true)
  expect(sliderInitialValues(config)).toEqual([0.3, 0.6])
  expect(normalizeSliderValue(-100, config)).toBe(-0.3)
  expect(normalizeSliderValue(100, config)).toBe(0.6)
  expect(normalizeSliderValue(0.1 + 0.2, config)).toBe(0.3)
  expect(normalizeSliderValue(0.3999999999999, config)).toBe(0.4)
})

test('a full magnitude range with the smallest supported step stays finite', () => {
  const config = {
    ...SLIDER_MODULE_DEFAULT_CONFIG,
    min: -1_000_000,
    max: 1_000_000,
    step: 0.000001
  }
  expect(resolveSliderModule(createSliderModuleInstance(config))?.ok).toBe(true)
  expect(normalizeSliderValue(999_999.999999, config)).toBe(999_999.999999)
  expect(normalizeSliderValue(-999_999.999999, config)).toBe(-999_999.999999)
})
