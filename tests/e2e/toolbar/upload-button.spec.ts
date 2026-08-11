import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

const PLUGIN_ID = 'open-pencil.upload-button'
const MODULE_TYPE = 'upload-button'

async function canvasPluginModules(page: Page) {
  return page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.graph
      .getChildren(store.state.currentPageId)
      .flatMap((node) => (node.interactiveProps?.module ? [node.interactiveProps.module] : []))
      .map(({ pluginId, moduleType }) => ({ pluginId, moduleType }))
  })
}

async function selectedModuleJson(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const selectedId = [...store.state.selectedIds][0]
    const module = selectedId ? store.graph.getNode(selectedId)?.interactiveProps?.module : null
    return module ? JSON.stringify(module) : null
  })
}

async function pluginRuntimeState(page: Page) {
  return page.evaluate(async (pluginId) => {
    const { appPluginStore, appPluginStoreReady, appPluginStoreSnapshot } =
      await import('/src/app/plugins/index.ts')
    await appPluginStoreReady
    const plugin = appPluginStore
      .snapshot()
      .installed.find((candidate) => candidate.package.manifest.plugin.id === pluginId)
    const { inspectInstalledPluginModuleCompatibility } = await import('/src/app/plugins/index.ts')
    const installedModules = appPluginStore
      .installedModules()
      .filter((module) => module.plugin.package.manifest.plugin.id === pluginId)
    return {
      installed: Boolean(plugin),
      enabled: plugin?.enabled ?? false,
      blockedReason: plugin?.blockedReason ?? null,
      reactiveEnabled:
        appPluginStoreSnapshot.value.installed.find(
          (candidate) => candidate.package.manifest.plugin.id === pluginId
        )?.enabled ?? false,
      modules: installedModules.map((module) => module.contribution.moduleType),
      compatible: installedModules.map(
        (module) => inspectInstalledPluginModuleCompatibility(module).ok
      )
    }
  }, PLUGIN_ID)
}

async function installAndEnablePlugin(page: Page): Promise<void> {
  await page.evaluate(async (pluginId) => {
    const { appPluginStore, appPluginStoreReady } = await import('/src/app/plugins/index.ts')
    await appPluginStoreReady
    const installed = appPluginStore
      .snapshot()
      .installed.find((plugin) => plugin.package.manifest.plugin.id === pluginId)
    if (!installed) await appPluginStore.install(pluginId)
    if (!installed?.enabled) await appPluginStore.setEnabled(pluginId, true)
  }, PLUGIN_ID)
}

test('installs and configures local-only file selection without invalid drafts', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await expect
    .poll(() => pluginRuntimeState(page))
    .toEqual({
      installed: false,
      enabled: false,
      blockedReason: null,
      reactiveEnabled: false,
      modules: [],
      compatible: []
    })

  await installAndEnablePlugin(page)
  const uploadItem = page.getByTestId(`toolbar-plugin-module-${PLUGIN_ID}-${MODULE_TYPE}`)
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(uploadItem).toBeVisible()
  await uploadItem.click()
  await canvas.waitForRender()
  await expect
    .poll(() => canvasPluginModules(page))
    .toContainEqual({ pluginId: PLUGIN_ID, moduleType: MODULE_TYPE })

  await expect(page.getByTestId('upload-accept-editor')).toBeVisible()
  await expect(page.getByTestId('upload-local-only-notice')).toContainText(
    'not uploaded or persisted'
  )
  await expect(page.getByTestId('upload-accept-validation-hint')).toContainText('only a hint')
  const addType = page.getByTestId('upload-accept-add')
  expect((await addType.boundingBox())?.height).toBeGreaterThanOrEqual(44)

  await addType.click()
  let inputs = page.getByTestId('upload-accept-input')
  await inputs.first().fill('.PNG')
  await inputs.first().press('Enter')
  await expect.poll(() => selectedModuleJson(page)).toContain('"accept":[".png"]')

  await addType.click()
  inputs = page.getByTestId('upload-accept-input')
  await inputs.last().fill('image/*')
  await inputs.last().press('Enter')
  await expect.poll(() => selectedModuleJson(page)).toContain('"accept":[".png","image/*"]')

  await addType.click()
  await expect(page.getByTestId('upload-accept-row')).toHaveCount(3)
  await page.getByTestId('upload-accept-remove').last().click()
  await expect(page.getByTestId('upload-accept-row')).toHaveCount(2)
  await expect(page.getByTestId('upload-accept-input').last()).toBeFocused()
  await expect.poll(() => selectedModuleJson(page)).toContain('"accept":[".png","image/*"]')

  inputs = page.getByTestId('upload-accept-input')
  await inputs.last().fill('not-a-type')
  await inputs.last().blur()
  await expect(page.getByTestId('upload-accept-local-error')).toBeVisible()
  await expect.poll(() => selectedModuleJson(page)).toContain('"accept":[".png","image/*"]')
  await inputs.last().fill('.PNG')
  await inputs.last().press('Enter')
  await expect(page.getByTestId('upload-accept-local-error')).toContainText('must be unique')
  await inputs.last().fill('application/pdf')
  await inputs.last().press('Enter')
  await expect.poll(() => selectedModuleJson(page)).toContain('"accept":[".png","application/pdf"]')

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await expect(inputs.first()).toHaveCSS('background-color', 'rgb(31, 35, 40)')
  await expect(inputs.first()).toHaveCSS('color', 'rgb(255, 255, 255)')
  await inputs.first().focus()
  await expect(inputs.first()).toBeFocused()
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  await expect(inputs.first()).toHaveCSS('background-color', 'rgb(240, 240, 240)')
  await expect(inputs.first()).toHaveCSS('color', 'rgb(30, 30, 30)')

  const multiple = page
    .getByTestId('module-property-input')
    .and(page.locator('[data-module-path="multiple"]'))
  const multipleControl = page
    .getByTestId('upload-boolean-control')
    .and(page.locator('[data-module-path="multiple"]'))
  const booleanControls = page.getByTestId('upload-boolean-control')
  const maxFiles = page.getByRole('spinbutton', { name: 'Maximum files' })
  const maxFileBytes = page.getByRole('spinbutton', { name: 'Maximum bytes per file' })
  await expect(booleanControls).toHaveCount(5)
  expect(
    await booleanControls.evaluateAll((controls) =>
      controls.every((control) => control.getBoundingClientRect().height >= 44)
    )
  ).toBe(true)
  expect((await maxFiles.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  expect((await maxFileBytes.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await expect(maxFiles).toBeDisabled()
  await expect(page.getByTestId('upload-single-file-max-hint')).toContainText(
    'maximum file count at 1'
  )

  await multipleControl.click()
  await expect(multiple).toBeChecked()
  await expect.poll(() => selectedModuleJson(page)).toContain('"multiple":true')
  await expect.poll(() => selectedModuleJson(page)).toContain('"maxFiles":2')
  await expect(maxFiles).toBeEnabled()
  await multiple.focus()
  await expect(multiple).toBeFocused()
  expect(await multipleControl.evaluate((control) => getComputedStyle(control).boxShadow)).not.toBe(
    'none'
  )
  await maxFiles.focus()
  await maxFiles.fill('4')
  await maxFiles.press('Enter')
  await expect.poll(() => selectedModuleJson(page)).toContain('"maxFiles":4')
  await multiple.focus()
  await multiple.press('Space')
  await expect.poll(() => selectedModuleJson(page)).toContain('"multiple":false')
  await expect.poll(() => selectedModuleJson(page)).toContain('"maxFiles":1')
  await expect(maxFiles).toBeDisabled()

  await page.evaluate(async (pluginId) => {
    const { appPluginStore } = await import('/src/app/plugins/index.ts')
    await appPluginStore.setEnabled(pluginId, false)
  }, PLUGIN_ID)
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(uploadItem).toHaveCount(0)
  canvas.assertNoErrors()
})
