import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const COMPILER_PREVIEW_POPOUT_PLUGIN_ID = 'open-pencil.compiler-preview-popout'

async function openInstalledPlugins(page: Page): Promise<void> {
  await page.getByTestId('app-settings-trigger').click()
  await page.getByTestId('settings-section-plugins').click()
  await expect(page.getByTestId('settings-plugins-panel')).toBeVisible()
  await page.getByTestId('settings-plugins-view').getByText('Installed', { exact: true }).click()
}

test('persists compiler preview popout controls and keeps them beneath the plugin gate', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await openInstalledPlugins(page)

  const panel = page.getByTestId('plugin-compiler-preview-popout-controls')
  const pluginSwitch = page.getByTestId(`plugin-enabled-${COMPILER_PREVIEW_POPOUT_PLUGIN_ID}`)
  const toolbar = page.getByTestId('plugin-compiler-preview-popout-control-toolbar')
  const reload = page.getByTestId('plugin-compiler-preview-popout-control-reload')
  const focusEditor = page.getByTestId('plugin-compiler-preview-popout-control-focus-editor')
  const alwaysOnTop = page.getByTestId('plugin-compiler-preview-popout-control-always-on-top')
  const diagnostics = page.getByTestId('plugin-compiler-preview-popout-control-diagnostics')
  const exportMicrofrontend = page.getByTestId(
    'plugin-compiler-preview-popout-control-export-microfrontend'
  )
  const deploy = page.getByTestId('plugin-compiler-preview-popout-control-deploy')
  const reset = page.getByTestId('plugin-compiler-preview-popout-controls-reset')

  await expect(panel).toBeVisible()
  await expect(pluginSwitch).toBeChecked()
  await expect(toolbar).toBeChecked()
  await expect(reload).toBeChecked()
  await expect(focusEditor).toBeChecked()
  await expect(alwaysOnTop).not.toBeChecked()
  await expect(diagnostics).toBeChecked()
  await expect(exportMicrofrontend).toBeChecked()
  await expect(deploy).toBeChecked()

  await reload.click()
  await diagnostics.click()
  await page.getByTestId('app-settings-done').click()
  await page.reload()
  await canvas.waitForInit()
  await openInstalledPlugins(page)
  await expect(reload).not.toBeChecked()
  await expect(focusEditor).toBeChecked()
  await expect(diagnostics).not.toBeChecked()
  await expect(exportMicrofrontend).toBeChecked()
  await expect(deploy).toBeChecked()

  await toolbar.click()
  await expect(toolbar).not.toBeChecked()
  await expect(reload).toBeDisabled()
  await expect(focusEditor).toBeDisabled()
  await expect(alwaysOnTop).toBeDisabled()
  await expect(diagnostics).toBeDisabled()
  await expect(exportMicrofrontend).toBeDisabled()
  await expect(deploy).toBeDisabled()
  await expect(reload).not.toBeChecked()
  await expect(focusEditor).toBeChecked()
  await expect(diagnostics).not.toBeChecked()

  await pluginSwitch.click()
  await expect(panel).toHaveAttribute('aria-disabled', 'true')
  await expect(toolbar).toBeDisabled()
  await expect(reset).toBeDisabled()

  await pluginSwitch.click()
  await expect(panel).not.toHaveAttribute('aria-disabled', 'true')
  await expect(toolbar).toBeEnabled()
  await expect(toolbar).not.toBeChecked()
  await expect(focusEditor).toBeChecked()

  await reset.click()
  await expect(toolbar).toBeChecked()
  await expect(reload).toBeChecked()
  await expect(focusEditor).toBeChecked()
  await expect(alwaysOnTop).not.toBeChecked()
  await expect(diagnostics).toBeChecked()
  await expect(exportMicrofrontend).toBeChecked()
  await expect(deploy).toBeChecked()
  canvas.assertNoErrors()
})
