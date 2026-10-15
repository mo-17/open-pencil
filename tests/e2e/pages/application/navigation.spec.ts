import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import {
  reopenApplicationModeDocument,
  waitForApplicationDocument
} from '#tests/helpers/compiler/application-mode/editor'
import { applicationNavigationDocument } from '#tests/helpers/compiler/application-navigation/browser'
import { chooseAppSelect } from '#tests/helpers/properties'

const editor = useEditorSetup()
test.setTimeout(120_000)

// eslint-disable-next-line no-empty-pattern -- useEditorSetup owns the persistent browser.
test('application preview preserves the concrete URL and shared state across selection and automatic recompilation', async ({}, info) => {
  await editor.page.setViewportSize({ width: 2200, height: 1000 })
  await reopenApplicationModeDocument(editor.page, applicationNavigationDocument())
  const panel = editor.page.getByTestId('application-mode-panel')
  const role = panel.getByRole('combobox', { name: 'Current page role', exact: true })
  const preview = editor.page
    .getByTestId('lowcode-preview-pane')
    .locator('iframe[aria-label="lowcode preview"]')
  const runtime = editor.page.frameLocator('iframe[aria-label="lowcode preview"]')
  await expect(runtime.getByText('Home screen', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(role).toContainText('Design reference')
  await runtime.getByRole('button', { name: 'Increment shared count', exact: true }).click()
  await runtime.getByRole('button', { name: 'Open products', exact: true }).click()
  await expect(runtime.getByText('Product: 42 / tab: details', { exact: true })).toBeVisible()
  await expect(panel.getByRole('textbox', { name: 'Route path', exact: true })).toHaveValue(
    '/products/:id'
  )
  await waitForApplicationDocument(editor.page)
  const historyLength = await runtime.locator('body').evaluate(() => history.length)
  await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    const node = [...(store?.graph.getAllNodes() ?? [])].find(
      (item) => item.name === 'Product location'
    )
    if (!store || !node) throw new Error('Product location unavailable')
    store.select([node.id])
  })
  await expect(runtime.getByText('Product: 42 / tab: details', { exact: true })).toBeVisible()
  expect(await runtime.locator('body').evaluate(() => history.length)).toBe(historyLength)
  await runtime.getByRole('button', { name: 'Open related product', exact: true }).click()
  await expect(runtime.getByText('Product: 73 / tab: related', { exact: true })).toBeVisible()
  await runtime.locator('body').evaluate(() => history.back())
  await expect(runtime.getByText('Product: 42 / tab: details', { exact: true })).toBeVisible()
  const before = await preview.getAttribute('src')
  await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    const node = [...(store?.graph.getAllNodes() ?? [])].find(
      (item) => item.name === 'Products title'
    )
    if (!store || !node) throw new Error('Product title unavailable')
    store.updateNodeWithUndo(node.id, { text: 'Products screen updated' })
  })
  await expect.poll(() => preview.getAttribute('src'), { timeout: 60_000 }).not.toBe(before)
  await expect(runtime.getByText('Products screen updated', { exact: true })).toBeVisible({
    timeout: 60_000
  })
  await expect(runtime.getByText('Product: 42 / tab: details', { exact: true })).toBeVisible()
  await expect(runtime.getByText('Shared count: 1', { exact: true })).toBeVisible()
  await expect
    .poll(() => runtime.locator('body').evaluate(() => location.hash))
    .toBe('#/products/42?tab=details&filter=a%2Fb#reviews')
  await editor.page
    .getByTestId('pages-item')
    .filter({ hasText: /^Reference$/ })
    .click()
  await waitForApplicationDocument(editor.page)
  await expect(role).toContainText('Design reference')
  const referenceBefore = await preview.getAttribute('src')
  await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    const node = [...(store?.graph.getAllNodes() ?? [])].find(
      (item) => item.name === 'Reference only'
    )
    if (!store || !node) throw new Error('Reference node unavailable')
    store.updateNodeWithUndo(node.id, { text: 'Updated design reference' })
    store.select([node.id])
  })
  await expect
    .poll(() => preview.getAttribute('src'), { timeout: 60_000 })
    .not.toBe(referenceBefore)
  await expect(runtime.getByText('Product: 42 / tab: details', { exact: true })).toBeVisible({
    timeout: 60_000
  })
  await expect(runtime.getByText('Shared count: 1', { exact: true })).toBeVisible()
  await expect(role).toContainText('Design reference')
  const start = panel.getByRole('combobox', { name: 'Application start page', exact: true })
  await start.click()
  await expect(
    editor.page.getByRole('option', { name: 'Products · Concrete path required', exact: true })
  ).toHaveAttribute('aria-disabled', 'true')
  await editor.page.keyboard.press('Escape')
  await editor.page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    const products = store?.graph.getPages().find((item) => item.name === 'Products')
    if (!store || !products) throw new Error('Products page unavailable')
    store.updateNodeWithUndo(store.graph.rootId, {
      lowcodeApplication: { version: 1, enabled: true, startPageId: products.id }
    })
  })
  const repair = panel.getByTestId('application-start-route-invalid')
  await expect(repair).toBeVisible()
  await chooseAppSelect(editor.page, start, 'Home')
  await expect(repair).toHaveCount(0)
  await expect(runtime.getByText('Product: 42 / tab: details', { exact: true })).toBeVisible({
    timeout: 60_000
  })
  await editor.page.screenshot({
    path: info.outputPath('application-navigation-editor.png'),
    fullPage: true
  })
  editor.canvas.assertNoErrors()
})
