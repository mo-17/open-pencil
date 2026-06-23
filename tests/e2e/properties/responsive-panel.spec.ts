import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear()

function responsivePanel() {
  return editor.page.getByTestId('lowcode-responsive')
}

function selectedResponsiveOverrides() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = [...store.state.selectedIds][0]
    if (!id) return null
    return store.graph.getNode(id)?.responsiveOverrides
  })
}

async function selectFrame() {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('FRAME', 120, 120, 320, 220)
    store.graph.updateNode(id, { name: 'Responsive frame' })
    store.select([id])
    store.state.sceneVersion++
  })
  await editor.canvas.waitForRender()
}

async function fillAndCommit(testId: string, value: string) {
  const input = editor.page.getByTestId(testId)
  await input.scrollIntoViewIfNeeded()
  await input.fill(value)
  await input.press('Tab')
  await editor.canvas.waitForRender()
}

test('responsive panel writes and clears breakpoint overrides', async () => {
  await selectFrame()

  await responsivePanel().scrollIntoViewIfNeeded()
  await expect(responsivePanel()).toBeVisible()

  await editor.page.getByTestId('lowcode-responsive-md-visible').selectOption('false')
  await editor.page.getByTestId('lowcode-responsive-md-layout-mode').selectOption('HORIZONTAL')
  await editor.page.getByTestId('lowcode-responsive-md-layout-wrap').selectOption('WRAP')
  await editor.page.getByTestId('lowcode-responsive-md-primary-axis-sizing').selectOption('HUG')
  await fillAndCommit('lowcode-responsive-md-itemSpacing', '24')
  await fillAndCommit('lowcode-responsive-md-paddingLeft', '16')
  await fillAndCommit('lowcode-responsive-md-width', '640')

  expect(await selectedResponsiveOverrides()).toEqual({
    md: {
      visible: false,
      layoutMode: 'HORIZONTAL',
      layoutWrap: 'WRAP',
      primaryAxisSizing: 'HUG',
      itemSpacing: 24,
      paddingLeft: 16,
      width: 640
    }
  })

  await editor.page.getByTestId('lowcode-responsive-md-clear').click()
  await editor.canvas.waitForRender()
  expect(await selectedResponsiveOverrides()).toEqual({})
  editor.canvas.assertNoErrors()
})
