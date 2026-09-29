import { expect, test } from 'bun:test'

import {
  createRatingModuleInstance,
  resolveRatingModule,
  RATING_MODULE_DEFAULT_CONFIG
} from '#core/plugins/rating'

test('Rating validates whole and half stars without coercion', () => {
  for (const allowHalf of [false, true]) {
    for (const max of [1, 5, 10]) {
      for (const initialValue of [0, max, allowHalf ? 0.5 : 1]) {
        const instance = createRatingModuleInstance({ max, allowHalf, initialValue })
        expect(resolveRatingModule(instance)?.ok).toBe(true)
        expect(instance.config).toMatchObject({ max, allowHalf, initialValue })
      }
    }
  }
  for (const patch of [
    { max: 11 },
    { max: 0 },
    { max: 4.5 },
    { max: '5' },
    { initialValue: -1 },
    { initialValue: 6 },
    { initialValue: 2.5 },
    { allowHalf: true, initialValue: 2.25 },
    { initialValue: Number.NaN },
    { disabled: 1 },
    { readOnly: 'true' },
    { allowClear: null },
    { starSize: 49 },
    { fontSize: 9 },
    { label: '' },
    { clearLabel: '' },
    { activeColor: 'url(https://example.com)' },
    { extra: true }
  ])
    expect(() => createRatingModuleInstance(patch)).toThrow()
})

test('Rating requires the exact stored config and version and does not mutate input', () => {
  const instance = createRatingModuleInstance({
    label: '使用体验',
    allowHalf: true,
    initialValue: 3.5
  })
  const before = structuredClone(instance)
  const resolved = resolveRatingModule(instance)
  expect(resolved?.ok).toBe(true)
  if (!resolved?.ok) throw new Error('Rating did not resolve')
  resolved.config.label = 'Changed projection'
  expect(instance).toEqual(before)
  for (const key of Object.keys(RATING_MODULE_DEFAULT_CONFIG)) {
    const config = Object.fromEntries(
      Object.entries(instance.config).filter(([field]) => field !== key)
    )
    expect(resolveRatingModule({ ...instance, config })?.ok).toBe(false)
  }
  for (const configVersion of [0, 2, 1.5, '1']) {
    expect(resolveRatingModule({ ...instance, configVersion })?.ok).toBe(false)
  }
  expect(resolveRatingModule({ ...instance, pluginId: 'other.rating' })).toBeNull()
  expect(resolveRatingModule(null)).toBeNull()
})

test('Rating rejects unsafe object access and stores authored defaults without runtime state', () => {
  let reads = 0
  const config = { ...RATING_MODULE_DEFAULT_CONFIG }
  Object.defineProperty(config, 'label', {
    enumerable: true,
    get() {
      reads++
      return 'unsafe'
    }
  })
  expect(resolveRatingModule({ ...createRatingModuleInstance(), config })?.ok).toBe(false)
  expect(reads).toBe(0)
  const first = createRatingModuleInstance()
  first.config.initialValue = 1
  expect(createRatingModuleInstance().config.initialValue).toBe(3)
  expect(Object.keys(first)).toEqual([
    'version',
    'pluginId',
    'moduleType',
    'configVersion',
    'config'
  ])
})
