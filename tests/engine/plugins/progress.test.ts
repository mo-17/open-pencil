import { expect, test } from 'bun:test'

import * as progress from '#core/plugins/progress'

import { expectModuleInstance } from '#tests/helpers/assert'

test('Progress defaults are independent FRAME module data and preserve a genuine zero', () => {
  const first = progress.createProgressModuleInstance({ value: 0 })
  const second = progress.createProgressModuleInstance()
  first.config.label = 'Changed'
  expect(second.config.label).toBe('Progress')
  expect(progress.PROGRESS_MODULE_DEFAULT_CONFIG.label).toBe('Progress')
  const resolved = progress.resolveProgressModule(first)
  expect(resolved?.ok).toBe(true)
  if (!resolved?.ok) throw new Error('Missing progress config')
  expect(progress.progressDisplayValue(resolved.config)).toBe('0%')
  expect(
    expectModuleInstance(progress.createProgressModuleFrameOverrides().interactiveProps?.module)
      .pluginId
  ).toBe('open-pencil.progress')
})

test('indeterminate Progress keeps an authored value but never presents it as measured progress', () => {
  for (const value of [0, 100, 37.25]) {
    const result = progress.resolveProgressModule(
      progress.createProgressModuleInstance({
        value,
        indeterminate: true,
        showValue: false,
        pendingLabel: '进度未知'
      })
    )
    if (!result?.ok) throw new Error('Missing pending config')
    expect(result.config.value).toBe(value)
    expect(progress.progressDisplayValue(result.config)).toBe('进度未知')
  }
  expect(
    progress.progressDisplayValue({ ...progress.PROGRESS_MODULE_DEFAULT_CONFIG, showValue: false })
  ).toBe('')
})

test('Progress rejects malformed envelopes, unknown versions and undeclared executable fields', () => {
  const instance = progress.createProgressModuleInstance()
  const { value: _value, ...missing } = instance.config
  for (const value of [
    { ...instance, configVersion: 2 },
    { ...instance, config: missing },
    { ...instance, config: { ...instance.config, onProgress: 'alert(1)' } }
  ])
    expect(progress.resolveProgressModule(value)?.ok).toBe(false)
  expect(progress.resolveProgressModule(null)).toBeNull()
  expect(progress.resolveProgressModule({ ...instance, moduleType: 'slider' })).toBeNull()
})

test('Progress bounds numeric precision, geometry, labels and CSS colors without coercion', () => {
  for (const patch of [
    { value: -0.01 },
    { value: 100.01 },
    { value: 0.001 },
    { value: Number.NaN },
    { value: Infinity },
    { value: '42' },
    { indeterminate: 'true' },
    { showValue: 1 },
    { variant: 'countdown' },
    { label: '' },
    { pendingLabel: 'x'.repeat(121) },
    { thickness: 0 },
    { thickness: 17 },
    { diameter: 47 },
    { diameter: 241 },
    { fontSize: 33 },
    { accentColor: 'url(https://example.com)' }
  ])
    expect(() => progress.createProgressModuleInstance(patch)).toThrow()
  for (const value of [0, 0.01, 37.25, 100])
    expect(
      progress.resolveProgressModule(progress.createProgressModuleInstance({ value }))?.ok
    ).toBe(true)
  expect(progress.createProgressModuleInstance({ value: 0.1 + 0.2 }).config.value).toBe(0.3)
})
