import { readFile } from 'node:fs/promises'

import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { openPreviewSyncDocument } from '#tests/helpers/compiler/preview-sync'
import { chooseAppSelect } from '#tests/helpers/properties'

const editor = useEditorSetup()
test.setTimeout(90_000)

async function snapshotPage() {
  return editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Editor not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Current page missing')
    return {
      policy: page.lowcodePageViewport ?? null,
      geometry: store.graph.getChildren(page.id).map((node) => ({
        id: node.id,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height
      }))
    }
  })
}

// eslint-disable-next-line no-empty-pattern -- The editor browser page is owned by useEditorSetup.
test('page modes switch with one undo, preserve design boxes and survive a real FIG download/reopen', async ({}, testInfo) => {
  await openPreviewSyncDocument(editor.page)
  await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
    return window.openPencil?.getStore?.().clearSelection()
  })
  const select = editor.page.getByTestId('page-viewport-select')
  await expect(select).toContainText('Fixed size')
  const initial = await snapshotPage()
  expect(initial.policy).toBeNull()
  await chooseAppSelect(editor.page, select, 'Responsive layout')
  expect((await snapshotPage()).policy).toEqual({ version: 1, mode: 'responsive' })
  await chooseAppSelect(editor.page, select, 'Scale to width')
  const fit = await snapshotPage()
  expect(fit.policy).toEqual({ version: 1, mode: 'fit-width' })
  expect(fit.geometry).toEqual(initial.geometry)
  await editor.page.getByTestId('toolbar').getByRole('button').first().focus()
  await editor.canvas.undo()
  await expect(select).toContainText('Responsive layout')
  await editor.canvas.redo()
  await expect(select).toContainText('Scale to width')
  await chooseAppSelect(editor.page, select, 'Fixed size')
  expect((await snapshotPage()).policy).toEqual({ version: 1, mode: 'fixed' })
  await chooseAppSelect(editor.page, select, 'Scale to width')
  await editor.page.getByTestId('toolbar').getByRole('button').first().focus()
  const downloadPromise = editor.page.waitForEvent('download')
  await editor.page.keyboard.press('Meta+s')
  const download = await downloadPromise
  const path = testInfo.outputPath('mobile-fit-width.fig')
  await download.saveAs(path)
  expect(await download.failure()).toBeNull()
  await testInfo.attach('saved-fit-width-document', {
    path,
    contentType: 'application/octet-stream'
  })
  await chooseAppSelect(editor.page, select, 'Responsive layout')
  const bytes = [...(await readFile(path))]
  await editor.page.evaluate(async (data) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Editor not initialized')
    await store.openFigFile(new File([new Uint8Array(data)], 'mobile-fit-width.fig'))
    store.clearSelection()
  }, bytes)
  await expect(select).toContainText('Scale to width')
  const reopened = await snapshotPage()
  expect(reopened.policy).toEqual(fit.policy)
  expect(reopened.geometry).toEqual(fit.geometry)
  await testInfo.attach('page-mode-screenshot', {
    body: await editor.page.screenshot(),
    contentType: 'image/png'
  })
  editor.canvas.assertNoErrors()
})
