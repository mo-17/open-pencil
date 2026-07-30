import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const LOOPBACK_MCP_URL = 'http://127.0.0.1:4711/mcp'

test('persists opt-in web search and code execution per model', async ({ page }) => {
  let providerRequests = 0
  await page.route(/^https:\/\/(?:openrouter\.ai\/api|api\.openai\.com)\//, async (route) => {
    providerRequests += 1
    await route.abort()
  })

  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-add-model').click()
  await page.getByLabel('Name').fill('OpenRouter web model')
  await page.getByTestId('settings-model-provider').click()
  await page.getByRole('option', { name: 'OpenRouter', exact: true }).click()
  const webSearch = page.getByTestId('settings-model-web-search')
  await expect(webSearch).toBeVisible()
  await expect(webSearch).not.toBeChecked()
  await expect(page.getByTestId('settings-model-code-execution')).toBeHidden()
  await webSearch.click()
  await expect(webSearch).toBeChecked()
  await page.getByRole('button', { name: 'Save model' }).click()

  await page.getByTestId('settings-add-model').click()
  await page.getByLabel('Name').fill('OpenAI code model')
  await page.getByTestId('settings-model-provider').click()
  await page.getByRole('option', { name: 'OpenAI', exact: true }).click()
  const codeExecution = page.getByTestId('settings-model-code-execution')
  await expect(codeExecution).toBeVisible()
  await expect(codeExecution).not.toBeChecked()
  await expect(page.getByTestId('settings-model-web-search')).toBeHidden()
  await codeExecution.click()
  await expect(codeExecution).toBeChecked()
  await page.getByRole('button', { name: 'Save model' }).click()
  await page.getByTestId('app-settings-done').click()

  await page.reload()
  await canvas.waitForInit()
  await page.getByTestId('app-settings-trigger').click()
  await page.locator('[data-model-id]', { hasText: 'OpenRouter web model' }).click()
  await expect(page.getByTestId('settings-model-web-search')).toBeChecked()
  await page.getByRole('button', { name: 'Back' }).click()
  await page.locator('[data-model-id]', { hasText: 'OpenAI code model' }).click()
  await expect(page.getByTestId('settings-model-code-execution')).toBeChecked()
  expect(providerRequests).toBe(0)
})

test('configures a remote MCP server and enables it for one model', async ({ page }) => {
  let loopbackRequests = 0
  await page.route('http://127.0.0.1:4711/**', async (route) => {
    loopbackRequests += 1
    await route.abort()
  })

  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.getByTestId('app-settings-trigger').click()
  const remoteMcpSection = page.getByTestId('settings-remote-mcp')
  await expect(remoteMcpSection).toBeVisible()
  await expect(remoteMcpSection).toContainText('No remote MCP servers configured.')

  await page.getByTestId('settings-add-remote-mcp').click()
  const serverEditor = page.getByTestId('settings-remote-mcp-editor')
  await serverEditor.getByLabel('Server name').fill('Local MCP')
  await serverEditor.getByLabel('Streamable HTTP URL').fill(LOOPBACK_MCP_URL)
  await expect(serverEditor.getByRole('button', { name: 'Save' })).toBeEnabled()
  await serverEditor.getByRole('button', { name: 'Save' }).click()

  await expect(serverEditor).toBeHidden()
  await expect(remoteMcpSection).toContainText('Local MCP')
  await expect(remoteMcpSection).toContainText('http://127.0.0.1:4711')
  await expect(remoteMcpSection).toContainText('No authentication')

  await page.getByTestId('settings-add-model').click()
  await page.getByLabel('Name').fill('MCP model')
  await page.getByTestId('settings-model-provider').click()
  await page.getByRole('option', { name: 'Google AI' }).click()
  await page.getByLabel('Model ID').click()
  await page.getByRole('option', { name: 'Gemini 3 Flash' }).click()
  const modelRemoteMcp = page.getByTestId('settings-model-remote-mcp')
  await expect(modelRemoteMcp).toContainText('Local MCP')
  const serverSwitch = modelRemoteMcp.getByRole('switch', { name: 'Local MCP' })
  await expect(serverSwitch).not.toBeChecked()
  await serverSwitch.click()
  await expect(serverSwitch).toBeChecked()
  await page.getByRole('button', { name: 'Save model' }).click()
  await page.getByTestId('app-settings-done').click()

  await page.reload()
  await canvas.waitForInit()
  await page.getByTestId('app-settings-trigger').click()
  await expect(page.getByTestId('settings-remote-mcp')).toContainText('Local MCP')
  await page.locator('[data-model-id]', { hasText: 'MCP model' }).click()
  await expect(
    page.getByTestId('settings-model-remote-mcp').getByRole('switch', { name: 'Local MCP' })
  ).toBeChecked()
  expect(loopbackRequests).toBe(0)
})
