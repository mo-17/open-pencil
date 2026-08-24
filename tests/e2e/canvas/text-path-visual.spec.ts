import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&no-chrome&no-rulers')

test('renders imported text on a path with its selection overlay', async () => {
  test.setTimeout(90_000)
  await editor.page.evaluate(async () => {
    const modulePath = '/src/app/editor/fonts/index.ts'
    const { onlineFontsEnabled } = (await import(modulePath)) as {
      onlineFontsEnabled: { value: boolean }
    }
    onlineFontsEnabled.value = false
    await Promise.resolve()
  })
  await editor.page.evaluate(() => window.openPencil?.openFile?.('/tests/fixtures/circle-text.fig'))
  await editor.canvas.waitForRender()

  const selected = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const node = [...store.graph.getAllNodes()].find(
      (candidate) => candidate.name === 'ArnoCoenen.art'
    )
    if (!node) return false
    store.select([node.id])
    store.zoomToSelection()
    store.requestRender()
    return true
  })
  expect(selected).toBe(true)
  await editor.page.waitForFunction(
    () => {
      const store = window.openPencil?.getStore?.()
      if (!store) return false
      return store.canvasRenderers.some((renderer) => {
        const backing = renderer.sceneBacking
        return (
          backing !== null &&
          renderer.sceneBackingBuild === null &&
          !renderer.sceneBackingNeedsCrispRender &&
          backing.pageId === store.state.currentPageId &&
          backing.sceneVersion === store.state.sceneVersion &&
          backing.fontGeneration === renderer.fontGeneration &&
          Math.abs(backing.zoom - store.state.zoom) < 0.0001
        )
      })
    },
    undefined,
    { timeout: 30_000 }
  )
  editor.canvas.assertNoErrors()

  const buffer = await editor.canvas.screenshotCanvasRegion()
  expect(buffer).toMatchSnapshot('text-path-rendering-and-selection.png')
})
