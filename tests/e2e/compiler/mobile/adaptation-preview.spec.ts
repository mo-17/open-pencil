import { expect, test } from '@playwright/test'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { CanvasHelper } from '#tests/helpers/canvas'

test.use({ viewport: { width: 2200, height: 1100 }, deviceScaleFactor: 1 })

test('Web adaptation tools preserve drafts, enlarge text, diagnose and locate authored nodes', async ({
  page
}, info) => {
  test.setTimeout(120_000)
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const pane = page.getByTestId('lowcode-preview-pane')
  await expect(pane).toHaveAttribute('data-preview-status', 'ready', { timeout: 60_000 })
  const ids = await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const pageId = store.state.currentPageId
    const field = store.graph.createNode('INPUT', pageId, {
      name: 'Adaptive draft',
      x: 24,
      y: 24,
      width: 250,
      height: 48,
      interactiveProps: { placeholder: 'Keep my adaptation draft' }
    })
    const text = store.graph.createNode('TEXT', pageId, {
      name: 'Fixed text height',
      text: 'A long label that needs room when the font becomes larger.',
      x: 24,
      y: 96,
      width: 230,
      height: 32,
      fontSize: 20,
      clipsContent: true
    })
    const overflow = store.graph.createNode('TEXT', pageId, {
      name: 'Offscreen label',
      text: 'Outside a narrow viewport',
      x: 360,
      y: 150,
      width: 200,
      height: 40,
      fontSize: 18
    })
    return { field: field.id, text: text.id, overflow: overflow.id }
  })
  const iframe = page.locator('iframe[aria-label="lowcode preview"]')
  const preview = page.frameLocator('iframe[aria-label="lowcode preview"]')
  const field = preview.getByPlaceholder('Keep my adaptation draft', { exact: true })
  await expect(field).toBeVisible({ timeout: 60_000 })
  await field.fill('Draft remains through every inspection')
  const element = await iframe.elementHandle()
  const frame = await element?.contentFrame()
  if (!element || !frame) throw new Error('Generated preview frame is unavailable')
  const originalURL = await iframe.getAttribute('src')
  const geometry = await page.evaluate(({ text }) => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const node = window.openPencil?.getStore?.().graph.getNode(text)
    return (
      node && {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        fontSize: node.fontSize
      }
    )
  }, ids)

  await page.getByTestId('lowcode-preview-viewport').selectOption('phone')
  const width = page.getByTestId('lowcode-preview-width')
  const height = page.getByTestId('lowcode-preview-height')
  await width.fill('320')
  await width.press('Enter')
  await height.fill('700')
  await height.press('Enter')
  await expect(iframe).toHaveCSS('width', '320px')
  await expect(iframe).toHaveCSS('height', '700px')
  await expect(page.getByTestId('lowcode-preview-viewport')).toHaveValue('custom')
  await page.getByTestId('lowcode-preview-width-slider').fill('360')
  await expect(iframe).toHaveCSS('width', '360px')
  await expect(height).toHaveValue('700')

  const text = preview.locator(`[data-node-id="${ids.text}"]`)
  const baseSize = await text.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))
  const fractionalText = preview.locator(`[data-node-id="${ids.overflow}"]`)
  const baseFractionalSize = await fractionalText.evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).fontSize)
  )
  // CSSOM canonicalizes 18 * 1.3; restoration must compare its stored CSS value.
  for (const scale of [1.3, 1.6]) {
    await page.getByTestId('lowcode-preview-text-scale').selectOption(String(scale))
    await expect
      .poll(() =>
        fractionalText.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))
      )
      .toBeCloseTo(baseFractionalSize * scale, 1)
    await page.getByTestId('lowcode-preview-text-scale').selectOption('1')
    await expect
      .poll(() =>
        fractionalText.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))
      )
      .toBeCloseTo(baseFractionalSize, 1)
  }
  await page.getByTestId('lowcode-preview-text-scale').selectOption('2')
  await expect
    .poll(() => text.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)))
    .toBeCloseTo(baseSize * 2, 1)
  await page.getByTestId('lowcode-preview-diagnostics').check()
  const diagnostics = page.getByTestId('preview-adaptation-diagnostics')
  await expect(diagnostics).toHaveAttribute('aria-busy', 'false')
  const overflow = diagnostics.locator(
    `[data-node-id="${ids.overflow}"][data-diagnostic-kind="horizontal-overflow"]`
  )
  await expect(overflow).toBeVisible()
  await overflow.click()
  expect(
    await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return [...(window.openPencil?.getStore?.().state.selectedIds ?? [])]
    })
  ).toEqual([ids.overflow])
  await expect(
    diagnostics.locator(`[data-node-id="${ids.text}"][data-diagnostic-kind="text-clipping"]`)
  ).toBeVisible()

  await page.getByTestId('lowcode-preview-keyboard').check()
  const keyboard = page.getByTestId('lowcode-preview-keyboard-overlay')
  await expect(keyboard).toBeVisible()
  expect(await keyboard.evaluate((node) => node.getBoundingClientRect().height)).toBe(300)
  await expect(field).toHaveValue('Draft remains through every inspection')
  expect(await iframe.getAttribute('src')).toBe(originalURL)
  expect(
    await element.evaluate(
      (node) =>
        node.isConnected && node === document.querySelector('iframe[aria-label="lowcode preview"]')
    )
  ).toBe(true)
  expect(
    await page.evaluate(({ text }) => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

      const node = window.openPencil?.getStore?.().graph.getNode(text)
      return (
        node && {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          fontSize: node.fontSize
        }
      )
    }, ids)
  ).toEqual(geometry)
  await page.screenshot({ path: info.outputPath('adaptation-tools.png') })

  await height.fill('240')
  await height.press('Enter')
  expect(await keyboard.evaluate((node) => node.getBoundingClientRect().height)).toBe(108)
  await expect(field).toHaveValue('Draft remains through every inspection')

  await page.getByTestId('lowcode-preview-diagnostics').uncheck()
  await expect(diagnostics).toHaveCount(0)
  await page.getByTestId('lowcode-preview-keyboard').uncheck()
  await page.getByTestId('lowcode-preview-text-scale').selectOption('1')
  await expect
    .poll(() => text.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)))
    .toBeCloseTo(baseSize, 1)
  await expect(field).toHaveValue('Draft remains through every inspection')
  await page.getByTestId('lowcode-preview-diagnostics').check()
  await expect(diagnostics).toBeVisible()
  const policy = page.getByTestId('lowcode-preview-refresh-policy')
  if (!(await policy.isVisible())) await page.getByTestId('lowcode-preview-settings-toggle').click()
  await policy.selectOption('manual')
  if (await page.getByTestId('lowcode-preview-settings-panel').isVisible()) {
    await page.getByTestId('lowcode-preview-settings-toggle').click()
  }
  // Reopening the same document can retain every node ID. Its old preview must lose authority.
  await page.evaluate(() => {
    if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')

    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const original = store.graph
    const Graph = original.constructor as typeof SceneGraph
    const replacement = new Graph()
    replacement.nodes = new Map(
      [...original.nodes].map(([id, node]) => [id, structuredClone(node)])
    )
    replacement.rootId = original.rootId
    store.replaceGraph(replacement, { currentPageId: store.state.currentPageId })
  })
  await expect(diagnostics).toHaveCount(0)
  await expect(page.getByTestId('lowcode-preview-diagnostics')).toBeDisabled()
  expect(await iframe.getAttribute('src')).toBe(originalURL)
  expect(
    await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return [...(window.openPencil?.getStore?.().state.selectedIds ?? [])]
    })
  ).toEqual([])
  const reload = page.getByTestId('lowcode-preview-reload')
  if (await reload.isVisible()) await reload.click()
  else await page.getByRole('button', { name: '↻', exact: true }).click()
  await expect(page.getByTestId('lowcode-preview-diagnostics')).toBeEnabled({ timeout: 60_000 })
  await expect(diagnostics).toBeVisible()
  canvas.assertNoErrors()
})
