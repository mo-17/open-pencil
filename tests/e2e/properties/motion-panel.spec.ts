import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { propertySection } from '#tests/helpers/properties'

const editor = useEditorSetupWithClear()

async function createRectangles(count: number) {
  return editor.page.evaluate((total) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const ids = Array.from({ length: total }, (_, index) =>
      store.createShape('RECTANGLE', 120 + index * 140, 120, 100, 80)
    )
    store.select(ids)
    store.state.sceneVersion++
    return ids
  }, count)
}

async function selectedMotion() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return [...store.state.selectedIds].map((id) => store.graph.getNode(id)?.motion)
  })
}

test.beforeEach(async () => {
  await editor.page.evaluate(() => {
    const storageName = 'localStorage'
    window[storageName].removeItem('open-pencil:inspector-section:motion')
  })
})

test('single-selection presets are keyboard accessible and expose motion controls', async () => {
  await createRectangles(1)
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  await expect(section).toBeVisible()
  await expect(section.getByRole('group', { name: 'Presets' })).toBeVisible()
  await expect(section.getByRole('button')).toHaveCount(8)

  const fadeIn = section.getByRole('button', { name: 'Fade in' })
  await fadeIn.focus()
  await expect(fadeIn).toBeFocused()
  await editor.page.keyboard.press('Space')
  await editor.canvas.waitForRender()

  await expect(fadeIn).toHaveAttribute('aria-pressed', 'true')
  await expect(section.getByRole('button')).toHaveCount(10)
  expect((await selectedMotion())[0]?.preset?.id).toBe('fade-in')
  await expect(section.getByRole('combobox', { name: 'Trigger' })).toBeEnabled()
  await expect(section.getByRole('spinbutton', { name: 'Duration' })).toBeEnabled()
  await expect(section.getByRole('spinbutton', { name: 'Delay' })).toBeEnabled()
  await expect(section.getByRole('combobox', { name: 'Reduced motion' })).toBeEnabled()
  const preview = section.getByRole('button', { name: 'Preview motion' })
  await expect(preview).toBeEnabled()
  await preview.click()
  const stopPreview = section.getByRole('button', { name: 'Stop preview' })
  await expect(stopPreview).toBeVisible()
  expect(
    await editor.page.evaluate(() => window.openPencil?.getStore?.().isMotionPreviewActive())
  ).toBe(true)
  await expect(preview).toBeVisible({ timeout: 2_000 })
  expect(
    await editor.page.evaluate(() => window.openPencil?.getStore?.().isMotionPreviewActive())
  ).toBe(false)

  await preview.click()
  await expect(stopPreview).toBeVisible()
  await stopPreview.click()
  await expect(preview).toBeVisible()
  expect(
    await editor.page.evaluate(() => window.openPencil?.getStore?.().isMotionPreviewActive())
  ).toBe(false)
  await expect(section.getByRole('button', { name: 'Clear motion' })).toBeEnabled()
})

test('multi-selection preset apply and clear are atomic and undoable', async () => {
  const ids = await createRectangles(2)
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  await section.getByRole('button', { name: 'Slide up' }).click()
  await editor.canvas.waitForRender()

  expect((await selectedMotion()).map((motion) => motion?.preset?.id)).toEqual([
    'slide-up',
    'slide-up'
  ])
  const undoLabel = await editor.page.evaluate(() => window.openPencil?.getStore?.().undo.undoLabel)
  expect(undoLabel).toBe('Apply motion preset')

  await editor.canvas.undo()
  expect(await selectedMotion()).toEqual(ids.map(() => undefined))
  await editor.canvas.redo()
  expect((await selectedMotion()).map((motion) => motion?.preset?.id)).toEqual([
    'slide-up',
    'slide-up'
  ])

  await section.getByRole('button', { name: 'Clear motion' }).click()
  await editor.canvas.waitForRender()
  expect(await selectedMotion()).toEqual(ids.map(() => undefined))
  await editor.canvas.undo()
  expect((await selectedMotion()).map((motion) => motion?.preset?.id)).toEqual([
    'slide-up',
    'slide-up'
  ])
})

test('mixed selection is explicit and applying a preset resolves it', async () => {
  const ids = await createRectangles(2)
  await editor.page.evaluate(
    ([firstId, secondId]) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      store.graph.updateNode(firstId, {
        motion: {
          version: 1,
          tracks: [
            {
              id: 'first',
              trigger: 'mount',
              keyframes: [
                { offset: 0, opacity: 0 },
                { offset: 1, opacity: 1 }
              ],
              timing: { durationMs: 300 }
            }
          ]
        }
      })
      store.graph.updateNode(secondId, {
        motion: {
          version: 1,
          tracks: [
            {
              id: 'second',
              trigger: 'hover',
              keyframes: [
                { offset: 0, y: 0 },
                { offset: 1, y: -8 }
              ],
              timing: { durationMs: 180 }
            }
          ]
        }
      })
      store.state.sceneVersion++
    },
    ids as [string, string]
  )
  await editor.canvas.waitForRender()

  const section = propertySection(editor.page, 'Motion')
  await section.scrollIntoViewIfNeeded()
  await expect(section.getByTestId('motion-status')).toHaveText('Mixed motion values')
  await expect(section.getByRole('combobox', { name: 'Trigger' })).toContainText('Mixed')
  await expect(section.getByRole('spinbutton', { name: 'Duration' })).toHaveAttribute(
    'data-mixed',
    ''
  )
  await expect(section.getByRole('button', { name: 'Preview motion' })).toBeDisabled()

  await section.getByRole('button', { name: 'Float' }).click()
  await editor.canvas.waitForRender()
  expect((await selectedMotion()).map((motion) => motion?.preset?.id)).toEqual(['float', 'float'])
  await expect(section.getByTestId('motion-status')).toHaveCount(0)
})

test('motion filter keywords match both single and multi selection', async () => {
  await createRectangles(1)
  await editor.canvas.waitForRender()
  const filter = editor.page.getByTestId('inspector-filter-input')

  await filter.fill('animation')
  await expect(editor.page.getByTestId('inspector-section-motion')).toBeVisible()
  await expect(editor.page.getByTestId('inspector-section-position')).not.toBeVisible()

  await editor.page.getByTestId('inspector-filter-clear').click()
  await createRectangles(2)
  await editor.canvas.waitForRender()
  await filter.fill('动画')
  await expect(editor.page.getByTestId('design-panel-multi')).toBeVisible()
  await expect(editor.page.getByTestId('inspector-section-motion')).toBeVisible()
  await expect(editor.page.getByTestId('inspector-section-appearance')).not.toBeVisible()
})
