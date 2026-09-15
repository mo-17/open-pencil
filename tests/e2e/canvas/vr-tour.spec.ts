import {
  VR_TOUR_MODULE_DEFAULT_CONFIG,
  createVRTourModuleFrameOverrides
} from '@open-pencil/core/plugins'

import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test&no-chrome&no-rulers&navigation-benchmark')

test('VR tour shows an offline room diagram on the design canvas', async () => {
  let panoramaRequests = 0
  await editor.page.route('https://media.example.com/**', async (route) => {
    panoramaRequests++
    await route.abort()
  })
  const config = structuredClone(VR_TOUR_MODULE_DEFAULT_CONFIG)
  config.scenes[0].panoramaUrl = 'https://media.example.com/room.jpg'
  const overrides = createVRTourModuleFrameOverrides(config)
  await editor.page.evaluate((overrides) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.graph.createNode('FRAME', store.state.currentPageId, {
      ...overrides,
      x: 72,
      y: 72
    })
    store.clearSelection()
    store.state.showRulers = false
    store.state.zoom = 1
    store.state.panX = 0
    store.state.panY = 0
    store.requestRender()
  }, overrides)
  await editor.canvas.waitForRender()
  await editor.page.evaluate(async () => {
    const navigation = window.openPencil?.test?.navigation
    if (!navigation) throw new Error('Canvas settlement hook not initialized')
    await navigation.waitForSettlement()
  })
  editor.canvas.assertNoErrors()
  expect(await editor.canvas.screenshotCanvasRegion()).toMatchSnapshot(
    'vr-tour-offline-diagram.png'
  )
  expect(panoramaRequests).toBe(0)
})
