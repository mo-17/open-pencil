import { expect, test } from 'bun:test'

import {
  CAROUSEL_STYLE_DEFAULTS,
  CAROUSEL_NAVIGATION_DEFAULTS,
  createCarouselModuleInstance,
  resolveCarouselModule
} from '@open-pencil/core/plugins'

import { getTool, setupToolTest } from '#tests/helpers/tools'

test('public module tools read legacy carousel inertly and upgrade only a validated explicit edit', () => {
  const { figma, graph } = setupToolTest()
  const current = createCarouselModuleInstance({ initialIndex: 1 })
  const config = structuredClone(current.config)
  for (const key of Object.keys({ ...CAROUSEL_STYLE_DEFAULTS, ...CAROUSEL_NAVIGATION_DEFAULTS }))
    Reflect.deleteProperty(config, key)
  const legacy = { ...current, configVersion: 1, config }
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    interactiveProps: { module: legacy }
  })
  let updates = 0
  const unbind = graph.onNodeEvents({
    updated: (id) => {
      if (id === node.id) updates++
    }
  })
  expect(getTool('read_module').execute(figma, { id: node.id })).toMatchObject({
    ok: true,
    data: {
      module: { configVersion: 3 },
      config: { ...CAROUSEL_STYLE_DEFAULTS, initialIndex: 1, swipeEnabled: false }
    }
  })
  expect(node.interactiveProps?.module).toEqual(legacy)
  expect(updates).toBe(0)
  const args = { id: node.id, plugin_id: 'open-pencil.carousel', module_type: 'carousel' }
  expect(
    getTool('update_module').execute(figma, { ...args, config: { overlayOpacity: 1 } })
  ).toMatchObject({ ok: false })
  expect(node.interactiveProps?.module).toEqual(legacy)
  expect(updates).toBe(0)
  expect(
    getTool('update_module').execute(figma, {
      ...args,
      config: {
        layout: 'overlay',
        textPosition: 'top',
        paginationStyle: 'numbers',
        arrowPosition: 'sides',
        swipeEnabled: true
      }
    })
  ).toMatchObject({ ok: true, data: { module: { configVersion: 3 } } })
  expect(updates).toBe(1)
  expect(resolveCarouselModule(node.interactiveProps?.module)).toMatchObject({
    ok: true,
    config: {
      layout: 'overlay',
      textPosition: 'top',
      paginationStyle: 'numbers',
      arrowPosition: 'sides',
      swipeEnabled: true,
      imageFit: 'cover',
      textAlign: 'left',
      overlayOpacity: 0.45,
      initialIndex: 1,
      slides: config.slides
    }
  })
  unbind()
})
