import { readFile } from 'node:fs/promises'

import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import {
  openApplicationModeDocument,
  reopenApplicationModeDocument,
  waitForApplicationDocument
} from '#tests/helpers/compiler/application-mode/editor'
import { chooseAppSelect } from '#tests/helpers/properties'

const editor = useEditorSetup()
test.setTimeout(120_000)

// eslint-disable-next-line no-empty-pattern -- useEditorSetup owns the persistent editor browser.
test('optional application setup supports undo and a real FIG save/reopen without losing design pages', async ({}, info) => {
  await editor.page.setViewportSize({ width: 2200, height: 1000 })
  await openApplicationModeDocument(editor.page)
  const panel = editor.page.getByTestId('application-mode-panel')
  const mode = panel.getByRole('checkbox', { name: 'Application mode', exact: true })
  const runtime = editor.page.frameLocator('iframe[aria-label="lowcode preview"]')
  await expect(mode).not.toBeChecked()
  await expect(editor.page.getByTestId('pages-item')).toHaveCount(3)
  await mode.check()
  await expect(runtime.getByText('Home screen', { exact: true })).toBeVisible({ timeout: 60_000 })
  await editor.page
    .getByTestId('pages-item')
    .filter({ hasText: /^Home$/ })
    .click()
  await waitForApplicationDocument(editor.page)
  const role = panel.getByRole('combobox', { name: 'Current page role', exact: true })
  const entry = panel.getByRole('combobox', { name: 'Entry frame', exact: true })
  const start = panel.getByRole('combobox', { name: 'Application start page', exact: true })
  await expect(role).toContainText('Application page')
  await expect(entry).toContainText('Home entry')
  const route = panel.getByRole('textbox', { name: 'Route path', exact: true })
  await expect(route).toHaveValue('/home')
  await route.fill('/welcome')
  await route.press('Enter')
  await editor.page.getByTestId('toolbar').getByRole('button').first().focus()
  await editor.canvas.undo()
  await expect(route).toHaveValue('/home')
  await editor.canvas.redo()
  await expect(route).toHaveValue('/welcome')
  // Restore the route targeted by the fixture's navigation action.
  await route.fill('/home')
  await route.press('Enter')
  await chooseAppSelect(editor.page, start, 'Products')
  await expect(start).toContainText('Products')
  await editor.page.getByTestId('toolbar').getByRole('button').first().focus()
  const downloading = editor.page.waitForEvent('download')
  await editor.page.keyboard.press('Meta+s')
  const download = await downloading
  const file = info.outputPath('application-mode.fig')
  await download.saveAs(file)
  expect(await download.failure()).toBeNull()
  await mode.uncheck()
  await expect(role).not.toBeVisible()
  await expect(editor.page.getByTestId('pages-item')).toHaveCount(3)
  await reopenApplicationModeDocument(editor.page, [...(await readFile(file))])
  await expect(mode).toBeChecked()
  await expect(runtime.getByText('Products screen', { exact: true })).toBeVisible({
    timeout: 60_000
  })
  await editor.page
    .getByTestId('pages-item')
    .filter({ hasText: /^Home$/ })
    .click()
  await waitForApplicationDocument(editor.page)
  await expect(runtime.getByText('Home screen', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(role).toContainText('Application page')
  await expect(entry).toContainText('Home entry')
  await expect(route).toHaveValue('/home')
  await expect(start).toContainText('Products')
  await editor.page
    .getByTestId('pages-item')
    .filter({ hasText: /^Reference$/ })
    .click()
  await waitForApplicationDocument(editor.page)
  await expect(role).toContainText('Design reference')
  await expect(entry).toBeDisabled()
  await expect(runtime.getByText('Home screen', { exact: true })).toBeVisible()
  await expect(role).toContainText('Design reference')
  await editor.page
    .getByTestId('pages-item')
    .filter({ hasText: /^Home$/ })
    .click()
  await waitForApplicationDocument(editor.page)
  await info.attach('saved-application-document', {
    path: file,
    contentType: 'application/octet-stream'
  })
  const divider = editor.page.getByTestId('layers-panel').getByRole('separator')
  const handle = await divider.boundingBox()
  if (!handle) throw new Error('Pages/layers divider is unavailable')
  await editor.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await editor.page.mouse.down()
  await editor.page.mouse.move(handle.x + handle.width / 2, handle.y + 250, { steps: 10 })
  await editor.page.mouse.up()
  await editor.page.getByTestId('toolbar').getByRole('button').first().focus()
  await editor.page.keyboard.press('Shift+Digit1')
  await editor.canvas.waitForRender()
  const preview = editor.page
    .getByTestId('lowcode-preview-pane')
    .locator('iframe[aria-label="lowcode preview"]')
  await expect(preview).toBeVisible({ timeout: 60_000 })
  await expect(runtime.getByText('Shared count: 0', { exact: true })).toBeVisible()
  await runtime.getByRole('button', { name: 'Increment shared count', exact: true }).click()
  await expect(runtime.getByText('Shared count: 1', { exact: true })).toBeVisible()
  await runtime.getByRole('button', { name: 'Open products', exact: true }).click()
  await expect(runtime.getByText('Products screen', { exact: true })).toBeVisible()
  await expect(runtime.getByText('Shared count: 1', { exact: true })).toBeVisible()
  await expect(entry).toContainText('Products entry')
  await waitForApplicationDocument(editor.page)
  await runtime.getByRole('button', { name: 'Return home', exact: true }).click()
  await expect(runtime.getByText('Home screen', { exact: true })).toBeVisible()
  await expect(runtime.getByText('Shared count: 1', { exact: true })).toBeVisible()
  await expect(entry).toContainText('Home entry')
  await waitForApplicationDocument(editor.page)
  await editor.page
    .getByTestId('lowcode-preview-pane')
    .getByRole('button', { name: '↻', exact: true })
    .click()
  await expect(runtime.getByText('Shared count: 0', { exact: true })).toBeVisible({
    timeout: 60_000
  })
  await runtime.getByRole('button', { name: 'Increment shared count', exact: true }).click()
  await expect(runtime.getByText('Shared count: 1', { exact: true })).toBeVisible()
  await editor.page.screenshot({
    path: info.outputPath('application-mode-editor.png'),
    fullPage: true
  })
  editor.canvas.assertNoErrors()
})
