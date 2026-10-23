import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test('runtime debug traces real React actions and blocked requests without collecting values', async ({
  page
}) => {
  test.setTimeout(90_000)
  let requestCount = 0
  await page.route('https://runtime-debug.example.test/**', (route) => {
    requestCount++
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ internal: 'private-response-value' })
    })
  })
  await page.goto('/')
  await new CanvasHelper(page).waitForInit()
  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Editor is not ready')
    store.graph.updateNode(store.graph.rootId, {
      lowcodeDocumentState: [
        { id: 'debug-value', name: 'debugValue', type: 'string', defaultValue: 'initial' },
        { id: 'debug-result', name: 'debugResult', type: 'object', defaultValue: {} }
      ]
    })
    store.graph.createNode('BUTTON', store.state.currentPageId, {
      name: 'Run trace',
      text: 'Run trace',
      x: 24,
      y: 24,
      width: 180,
      height: 40,
      interactiveProps: { text: 'Run trace' },
      events: {
        onClick: [
          {
            id: 'debug-write',
            kind: 'setVariable',
            targetName: 'debugValue',
            valueExpr: '"private-debug-value"'
          },
          {
            id: 'debug-fetch',
            kind: 'apiCall',
            method: 'GET',
            url: 'https://runtime-debug.example.test/result?token=private-url-value',
            targetName: 'debugResult'
          }
        ]
      }
    })
    store.graph.createNode('INPUT', store.state.currentPageId, {
      name: 'Debug value',
      x: 24,
      y: 80,
      width: 200,
      height: 40,
      interactiveProps: { placeholder: 'Debug value' },
      bindings: { value: { kind: 'docState', docStateName: 'debugValue' } }
    })
  })
  const preview = page.frameLocator('iframe[aria-label="lowcode preview"]')
  await expect(preview.getByRole('button', { name: 'Run trace' })).toBeVisible({ timeout: 60_000 })
  const pane = page.getByTestId('lowcode-preview-pane')
  await expect(pane).toHaveAttribute('data-preview-status', 'ready')
  const toggle = pane.getByRole('button', { name: /^(Runtime debug|运行调试)$/ })
  if (await toggle.isVisible()) await toggle.click()
  else {
    await pane.getByRole('button', { name: 'More preview actions' }).click()
    await page.getByRole('menuitem', { name: /Runtime debug|运行调试/ }).click()
  }
  const debug = pane.locator('[data-property="runtime-debug"]')
  await expect(debug).toBeVisible()
  await preview.getByRole('button', { name: 'Run trace' }).click()
  await expect(preview.getByPlaceholder('Debug value')).toHaveValue('private-debug-value')
  // Browser Worker previews deliberately use connect-src 'none'. The trace
  // reports that real blocked request without relaxing the sandbox for a test.
  await expect(debug.locator('[data-kind="request"][data-status="error"]')).toContainText('GET')
  expect(requestCount).toBe(0)
  await expect(debug.locator('[data-kind="expression"][data-status="success"]')).toHaveCount(1)
  await expect(
    debug.locator('[data-kind="state"]').filter({ hasText: 'debugValue' }).first()
  ).toBeVisible()
  const actionTrace = await debug
    .locator('[data-kind="action"][data-status="start"]')
    .filter({ hasText: 'setVariable' })
    .getAttribute('data-trace')
  await expect(debug.locator('[data-kind="request"][data-status="error"]')).toHaveAttribute(
    'data-trace',
    actionTrace ?? ''
  )
  await expect(debug).not.toContainText('private-debug-value')
  await expect(debug).not.toContainText('private-response-value')
  await expect(debug).not.toContainText('private-url-value')
  await page.screenshot({ path: test.info().outputPath('runtime-debug.png') })
  await debug.getByRole('button', { name: /^(Pause|暂停记录)$/ }).click()
  const retained = await debug.locator('ol > li').count()
  await preview.getByPlaceholder('Debug value').fill('private-paused-value')
  await expect(preview.getByPlaceholder('Debug value')).toHaveValue('private-paused-value')
  await expect(debug.locator('ol > li')).toHaveCount(retained)
  await debug.getByRole('button', { name: /^(Clear|清空)$/ }).click()
  await expect(debug.locator('ol > li')).toHaveCount(0)
})
