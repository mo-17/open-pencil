import { expect, test } from 'bun:test'

import { omit } from 'es-toolkit/object'

import {
  CAROUSEL_STYLE_DEFAULTS,
  createCarouselModuleInstance,
  resolveCarouselModule
} from '#core/plugins/carousel'

test('new carousels enable swipe and preserve the existing bottom-corner arrows', () => {
  const instance = createCarouselModuleInstance()
  expect(instance.configVersion).toBe(3)
  expect(instance.config).toMatchObject({ arrowPosition: 'bottom-corners', swipeEnabled: true })
})

test('v1 and v2 retain their prior non-swipe interaction without changing saved data', () => {
  const current = createCarouselModuleInstance({ layout: 'overlay', textPosition: 'center' })
  const v2 = omit(current.config, ['arrowPosition', 'swipeEnabled'])
  for (const version of [1, 2]) {
    const config = version === 1 ? omit(v2, Object.keys(CAROUSEL_STYLE_DEFAULTS)) : v2
    const legacy = { ...current, configVersion: version, config }
    const before = structuredClone(legacy)
    const resolved = resolveCarouselModule(legacy)
    if (!resolved?.ok) throw new Error('Expected legacy carousel to resolve')
    expect(resolved.instance.configVersion).toBe(3)
    expect(resolved.config).toMatchObject({
      arrowPosition: 'bottom-corners',
      swipeEnabled: false,
      layout: version === 1 ? 'split' : 'overlay'
    })
    expect(legacy).toEqual(before)
    resolved.config.slides[0].title = 'Changed projection'
    expect(legacy).toEqual(before)
    for (const patch of [{ swipeEnabled: true }, { arrowPosition: 'sides' }, { extra: true }]) {
      expect(resolveCarouselModule({ ...legacy, config: { ...config, ...patch } })?.ok).toBe(false)
    }
    expect(resolveCarouselModule({ ...legacy, configVersion: 3 })?.ok).toBe(false)
    expect(resolveCarouselModule({ ...legacy, configVersion: 4 })?.ok).toBe(false)
  }
})

test('arrow placement and swipe use a closed v3 contract without coercion', () => {
  for (const arrowPosition of [
    'sides',
    'top-corners',
    'bottom-corners',
    'bottom-left',
    'bottom-right'
  ]) {
    for (const swipeEnabled of [true, false]) {
      const instance = createCarouselModuleInstance({ arrowPosition, swipeEnabled })
      expect(resolveCarouselModule(instance)?.ok).toBe(true)
      expect(instance.config).toMatchObject({ arrowPosition, swipeEnabled })
    }
  }
  for (const patch of [
    { arrowPosition: 'center' },
    { arrowPosition: null },
    { arrowPosition: {} },
    { swipeEnabled: 'true' },
    { swipeEnabled: 1 },
    { swipeEnabled: null },
    { swipeEnabled: [] }
  ])
    expect(() => createCarouselModuleInstance(patch)).toThrow()
  const instance = createCarouselModuleInstance()
  for (const field of ['arrowPosition', 'swipeEnabled']) {
    expect(resolveCarouselModule({ ...instance, config: omit(instance.config, [field]) })?.ok).toBe(
      false
    )
  }
})
