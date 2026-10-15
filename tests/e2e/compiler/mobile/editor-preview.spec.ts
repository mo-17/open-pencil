import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test.use({ viewport: { width: 2200, height: 1000 }, deviceScaleFactor: 1 })

test('editor preview changes real iframe dimensions without losing an unsaved input', async ({
  page
}, info) => {
  test.setTimeout(120_000)
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const pane = page.getByTestId('lowcode-preview-pane')
  await expect(pane).toHaveAttribute('data-preview-host', 'browser-worker', { timeout: 60_000 })
  await expect(pane).toHaveAttribute('data-preview-status', 'ready', { timeout: 60_000 })
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.graph.createNode('INPUT', store.state.currentPageId, {
      name: 'Viewport draft field',
      x: 24,
      y: 24,
      width: 320,
      height: 48,
      interactiveProps: { placeholder: 'Responsive preview draft' }
    })
  })
  const iframe = page.locator('iframe[aria-label="lowcode preview"]')
  const field = page
    .frameLocator('iframe[aria-label="lowcode preview"]')
    .getByPlaceholder('Responsive preview draft', { exact: true })
  await expect(field).toBeVisible({ timeout: 60_000 })
  await field.fill('Keep this unsaved draft across preview sizes')
  const element = await iframe.elementHandle()
  const frame = await element?.contentFrame()
  if (!element || !frame) throw new Error('The generated preview iframe must be attached')
  await frame.evaluate(() => {
    document.documentElement.dataset.viewportContinuity = 'same-preview-document'
  })
  const originalURL = await iframe.getAttribute('src')
  const size = page.getByTestId('lowcode-preview-viewport')
  for (const [name, width, height] of [
    ['phone', 390, 844],
    ['landscape', 844, 390],
    ['tablet', 768, 1024],
    ['desktop', 1440, 1000]
  ] as const) {
    await size.selectOption(name)
    await expect(iframe).toHaveCSS('width', `${width}px`)
    await expect(iframe).toHaveCSS('height', `${height}px`)
    await expect
      .poll(() => frame.evaluate(() => [innerWidth, innerHeight]))
      .toEqual([width, height])
    expect(
      await element.evaluate(
        (node) =>
          node.isConnected &&
          node === document.querySelector('iframe[aria-label="lowcode preview"]')
      )
    ).toBe(true)
    expect(await frame.locator('html').getAttribute('data-viewport-continuity')).toBe(
      'same-preview-document'
    )
    await expect(field).toHaveValue('Keep this unsaved draft across preview sizes')
    expect(await iframe.getAttribute('src')).toBe(originalURL)
  }
  await size.selectOption('fit')
  await expect(field).toHaveValue('Keep this unsaved draft across preview sizes')
  await expect(pane).toHaveAttribute('data-preview-status', 'ready')
  await page.screenshot({ path: info.outputPath('editor-preview-size-retains-draft.png') })
  canvas.assertNoErrors()
})
