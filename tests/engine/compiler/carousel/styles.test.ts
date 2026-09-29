import { describe, expect, test } from 'bun:test'

import { CAROUSEL_COMPILER_MODULE_LOWERER } from '#compiler/modules/carousel'

import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { createCarouselModuleInstance } from '#core/plugins/carousel'

const APPEARANCE = {
  layout: 'overlay',
  imageFit: 'contain',
  textPosition: 'center',
  textAlign: 'right',
  overlayOpacity: 0.7,
  paginationStyle: 'numbers'
} as const

describe('carousel appearance compiler contract', () => {
  test('preserves every authored v2 appearance setting through the module lowerer', () => {
    const instance = createCarouselModuleInstance(APPEARANCE)
    const snapshot = structuredClone(instance)
    const node = createDefaultNode(() => 'carousel', 'FRAME')
    const result = CAROUSEL_COMPILER_MODULE_LOWERER.lower(instance, node)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.payload).toMatchObject(APPEARANCE)
    expect(instance).toEqual(snapshot)
  })
})
