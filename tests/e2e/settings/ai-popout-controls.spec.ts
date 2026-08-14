import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const AI_POPOUT_PLUGIN_ID = 'open-pencil.ai-popout'

async function openInstalledPlugins(page: Page): Promise<void> {
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  await expect(page.getByTestId('settings-plugins-panel')).toBeVisible()
  await page.getByTestId('settings-plugins-view').getByText('Installed', { exact: true }).click()
}

test('persists AI popout controls and keeps them beneath the plugin gate', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await openInstalledPlugins(page)

  const panel = page.getByTestId('plugin-ai-popout-controls')
  const pluginSwitch = page.getByTestId(`plugin-enabled-${AI_POPOUT_PLUGIN_ID}`)
  const toolbar = page.getByTestId('plugin-ai-popout-control-toolbar')
  const focusEditor = page.getByTestId('plugin-ai-popout-control-focus-editor')
  const alwaysOnTop = page.getByTestId('plugin-ai-popout-control-always-on-top')
  const clearChat = page.getByTestId('plugin-ai-popout-control-clear-chat')
  const settings = page.getByTestId('plugin-ai-popout-control-settings')
  const reset = page.getByTestId('plugin-ai-popout-controls-reset')

  await expect(panel).toBeVisible()
  await expect(pluginSwitch).toBeChecked()
  await expect(toolbar).toBeChecked()
  await expect(focusEditor).toBeChecked()
  await expect(alwaysOnTop).not.toBeChecked()
  await expect(clearChat).toBeChecked()
  await expect(settings).toBeChecked()

  await focusEditor.click()
  await page.getByTestId('app-settings-done').click()
  await page.reload()
  await canvas.waitForInit()
  await openInstalledPlugins(page)
  await expect(focusEditor).not.toBeChecked()

  await toolbar.click()
  await expect(toolbar).not.toBeChecked()
  await expect(focusEditor).toBeDisabled()
  await expect(alwaysOnTop).toBeDisabled()
  await expect(clearChat).toBeDisabled()
  await expect(settings).toBeDisabled()
  await expect(focusEditor).not.toBeChecked()

  await pluginSwitch.click()
  await expect(panel).toHaveAttribute('aria-disabled', 'true')
  await expect(toolbar).toBeDisabled()
  await expect(reset).toBeDisabled()

  await pluginSwitch.click()
  await expect(panel).not.toHaveAttribute('aria-disabled', 'true')
  await expect(toolbar).toBeEnabled()
  await expect(toolbar).not.toBeChecked()
  await expect(focusEditor).not.toBeChecked()

  await reset.click()
  await expect(toolbar).toBeChecked()
  await expect(focusEditor).toBeChecked()
  await expect(alwaysOnTop).not.toBeChecked()
  await expect(clearChat).toBeChecked()
  await expect(settings).toBeChecked()
  canvas.assertNoErrors()
})
