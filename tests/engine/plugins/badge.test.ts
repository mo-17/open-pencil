import { expect, test } from 'bun:test'

import {
  BADGE_MODULE_DEFAULT_CONFIG,
  BADGE_MODULE_DEFINITION,
  badgeDisplayValue,
  badgeIsVisible,
  badgeMetrics,
  createBadgeModuleInstance,
  resolveBadgeModule
} from '#core/plugins/badge'

test('Badge formats bounded numeric counts without losing the authored full value', () => {
  for (const [count, max, display] of [
    [0, 99, '0'],
    [99, 99, '99'],
    [100, 99, '99+'],
    [999_999_999, 999_999, '999999+']
  ] as const) {
    const module = createBadgeModuleInstance({ count, max })
    const resolved = resolveBadgeModule(module)
    if (!resolved?.ok) throw new Error('Badge did not resolve')
    expect(badgeDisplayValue(resolved.config)).toBe(display)
    expect(resolved.config.count).toBe(count)
    expect(badgeIsVisible(resolved.config)).toBe(count > 0)
    expect(badgeMetrics(resolved.config).width).toBeGreaterThanOrEqual(22)
  }
  expect(badgeIsVisible({ count: 0, mode: 'count', showZero: true })).toBe(true)
  expect(badgeIsVisible({ count: 0, mode: 'dot', showZero: false })).toBe(true)
  expect(badgeDisplayValue({ mode: 'dot', count: 100, max: 99 })).toBe('')
  for (const size of ['small', 'medium', 'large'] as const)
    for (const placement of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      expect(resolveBadgeModule(createBadgeModuleInstance({ size, placement }))?.ok).toBe(true)
    }
  expect(BADGE_MODULE_DEFINITION.fields.map((field) => field.path[0]).sort()).toEqual(
    Object.keys(BADGE_MODULE_DEFAULT_CONFIG).sort()
  )
})

test('Badge rejects coercion, unsupported slots and executable or unbounded data', () => {
  for (const config of [
    { count: -1 },
    { count: 1.5 },
    { count: '5' },
    { count: Infinity },
    { count: 1_000_000_000 },
    { max: 0 },
    { max: 1.5 },
    { max: 1_000_000 },
    { mode: 'status' },
    { size: 'giant' },
    { placement: 'outside' },
    { showZero: 1 },
    { label: '' },
    { hostLabel: '' },
    { hostLabel: 'x'.repeat(121) },
    { label: 'x'.repeat(81) },
    { badgeColor: 'url(https://example.com)' },
    { html: '<b>unsafe</b>' },
    { contentChildName: 'unsupported' },
    { dataSource: 'unread' }
  ]) {
    expect(() => createBadgeModuleInstance(config)).toThrow()
  }
  const module = createBadgeModuleInstance()
  for (const key of Object.keys(BADGE_MODULE_DEFAULT_CONFIG)) {
    const config = Object.fromEntries(
      Object.entries(module.config).filter(([name]) => name !== key)
    )
    expect(resolveBadgeModule({ ...module, config })?.ok).toBe(false)
  }
  for (const configVersion of [0, 2, '1', 1.5])
    expect(resolveBadgeModule({ ...module, configVersion })?.ok).toBe(false)
  expect(resolveBadgeModule({ ...module, pluginId: 'other.badge' })).toBeNull()
})

test('Badge resolves a fresh plain-data projection and never executes config accessors', () => {
  const module = createBadgeModuleInstance({ hostLabel: '<b>保留纯文本</b>', count: 120 })
  const before = structuredClone(module)
  const resolved = resolveBadgeModule(module)
  if (!resolved?.ok) throw new Error('Badge did not resolve')
  resolved.config.count = 1
  expect(module).toEqual(before)
  let reads = 0
  Object.defineProperty(module.config, 'count', {
    enumerable: true,
    get() {
      reads++
      return 5
    }
  })
  expect(resolveBadgeModule(module)?.ok).toBe(false)
  expect(reads).toBe(0)
  expect(createBadgeModuleInstance().config).toEqual(BADGE_MODULE_DEFAULT_CONFIG)
})
