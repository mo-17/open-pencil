import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear()

async function selectButton() {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('BUTTON', 120, 120, 180, 48)
    store.graph.updateNode(id, { name: 'Stateful button' })
    store.select([id])
    store.state.sceneVersion++
  })
  await editor.canvas.waitForRender()
}

function selectedStateOverrides() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = [...store.state.selectedIds][0]
    return id ? store.graph.getNode(id)?.stateOverrides : undefined
  })
}

async function fillAndCommit(testId: string, value: string) {
  const input = editor.page.getByTestId(testId)
  await input.fill(value)
  await input.press('Tab')
  await editor.canvas.waitForRender()
}

test('button interaction-state panel authors and clears hover overrides', async () => {
  await selectButton()

  const panel = editor.page.getByTestId('lowcode-interaction-states')
  await panel.scrollIntoViewIfNeeded()
  await expect(panel).toBeVisible()
  await expect(editor.page.getByTestId('lowcode-interaction-state-hover')).toHaveAttribute(
    'aria-selected',
    'true'
  )

  await editor.page.getByTestId('lowcode-interaction-fill-enabled').check()
  await editor.page.getByTestId('lowcode-interaction-fill-color').fill('#123456')
  await editor.page.getByTestId('lowcode-interaction-stroke-enabled').check()
  await editor.page.getByTestId('lowcode-interaction-stroke-color').fill('#ABCDEF')
  await fillAndCommit('lowcode-interaction-stroke-width', '2')
  await fillAndCommit('lowcode-interaction-opacity', '80')
  await fillAndCommit('lowcode-interaction-radius', '12')

  const hover = (await selectedStateOverrides())?.hover
  expect(hover?.fills?.[0]).toMatchObject({
    type: 'SOLID',
    visible: true,
    color: { r: 0x12 / 255, g: 0x34 / 255, b: 0x56 / 255, a: 1 }
  })
  expect(hover?.strokes?.[0]).toMatchObject({
    visible: true,
    weight: 2,
    align: 'INSIDE',
    color: { r: 0xab / 255, g: 0xcd / 255, b: 0xef / 255, a: 1 }
  })
  expect(hover?.opacity).toBe(0.8)
  expect(hover?.cornerRadius).toBe(12)

  await editor.page.getByTestId('lowcode-interaction-state-disabled').click()
  await fillAndCommit('lowcode-interaction-opacity', '50')
  expect((await selectedStateOverrides())?.disabled?.opacity).toBe(0.5)

  await editor.page.getByTestId('lowcode-interaction-state-hover').click()
  await editor.page.getByTestId('lowcode-interaction-clear').click()
  await editor.canvas.waitForRender()
  expect(await selectedStateOverrides()).toEqual({ disabled: { opacity: 0.5 } })
  editor.canvas.assertNoErrors()
})
