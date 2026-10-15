import { expect, test } from 'bun:test'

import {
  createDateRangeModuleFrameOverrides,
  createDateRangeModuleInstance,
  resolveDateRangeModule
} from '#core/plugins/date-range'

import { expectModuleInstance } from '#tests/helpers/assert'

test('date range preserves empty and partial values in a portable strict FRAME contract', () => {
  const empty = createDateRangeModuleInstance(),
    partial = createDateRangeModuleInstance({ initialEnd: '2024-02-29' })
  expect(resolveDateRangeModule(empty)?.ok).toBe(true)
  expect(partial.config.initialStart).toBe('')
  expect(partial.config.initialEnd).toBe('2024-02-29')
  const frame = createDateRangeModuleFrameOverrides({
    initialStart: '2024-02-29',
    initialEnd: '2024-02-29',
    min: '2024-02-29',
    max: '2024-02-29'
  })
  expect(expectModuleInstance(frame.interactiveProps?.module).version).toBe(1)
  const serialized = JSON.stringify(frame.interactiveProps?.module)
  expect(resolveDateRangeModule(JSON.parse(serialized))?.ok).toBe(true)
  expect(resolveDateRangeModule({ ...empty, configVersion: 2 })?.ok).toBe(false)
  expect(
    resolveDateRangeModule({ ...empty, config: { ...empty.config, handler: 'fetch()' } })?.ok
  ).toBe(false)
})
test('date range rejects invalid dates, inverted limits and unsafe presentation values', () => {
  for (const config of [
    { initialStart: '2023-02-29' },
    { initialEnd: '2024-02-30' },
    { initialStart: '2024-13-01' },
    { initialEnd: '2024-01-00' },
    { min: '2024-1-01' },
    { max: '2024-01-01T00:00:00Z' },
    { initialStart: '2024-01-02', initialEnd: '2024-01-01' },
    { min: '2024-02-01', max: '2024-01-01' },
    { min: '2024-02-01', initialStart: '2024-01-01' },
    { max: '2024-02-01', initialEnd: '2024-03-01' },
    { label: '' },
    { startLabel: 'x'.repeat(81) },
    { disabled: 1 },
    { allowClear: 'true' },
    { fontSize: Infinity },
    { fontSize: 25 },
    { borderRadius: -1 },
    { textColor: 'url(https://example.com)' },
    { accentColor: '#fff' }
  ])
    expect(() => createDateRangeModuleInstance(config)).toThrow()
})
test('date range configs are isolated and untrusted text remains inert data', () => {
  const first = createDateRangeModuleInstance({ label: '<img src=x onerror=alert(1)>' }),
    second = createDateRangeModuleInstance()
  expect(first.config.label).toBe('<img src=x onerror=alert(1)>')
  first.config.initialStart = '2026-01-01'
  expect(second.config.initialStart).toBe('')
  let reads = 0
  const config = { ...second.config }
  Object.defineProperty(config, 'label', {
    enumerable: true,
    get() {
      reads++
      return 'unsafe'
    }
  })
  expect(resolveDateRangeModule({ ...second, config })?.ok).toBe(false)
  expect(reads).toBe(0)
})
