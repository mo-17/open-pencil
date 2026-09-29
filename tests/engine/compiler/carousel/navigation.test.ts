import { expect, test } from 'bun:test'

import { CAROUSEL_COMPILER_MODULE_LOWERER } from '#compiler/modules/carousel'

import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { createCarouselModuleInstance } from '#core/plugins/carousel'

test.each(['sides', 'top-corners', 'bottom-corners', 'bottom-left', 'bottom-right'])(
  'preserves %s placement and an explicit swipe preference in the compiled payload',
  (arrowPosition) => {
    const node = createDefaultNode(() => 'carousel', 'FRAME')
    for (const swipeEnabled of [false, true]) {
      const instance = createCarouselModuleInstance({ arrowPosition, swipeEnabled })
      const result = CAROUSEL_COMPILER_MODULE_LOWERER.lower(instance, node)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.reason)
      expect(result.payload).toMatchObject({ arrowPosition, swipeEnabled })
    }
  }
)

test('v2 compilation keeps swiping disabled while new carousel instances enable it', () => {
  const instance = createCarouselModuleInstance()
  const { arrowPosition: _position, swipeEnabled: _enabled, ...v2Config } = instance.config
  const previous = { ...instance, configVersion: 2, config: v2Config }
  const snapshot = structuredClone(previous)
  const node = createDefaultNode(() => 'carousel', 'FRAME')
  const legacy = CAROUSEL_COMPILER_MODULE_LOWERER.lower(previous, node)
  const fresh = CAROUSEL_COMPILER_MODULE_LOWERER.lower(instance, node)
  expect(legacy.ok && legacy.payload.swipeEnabled).toBe(false)
  expect(fresh.ok && fresh.payload.swipeEnabled).toBe(true)
  expect(previous).toEqual(snapshot)
})
