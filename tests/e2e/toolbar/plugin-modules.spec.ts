import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

const MAP_PLUGIN_ID = 'open-pencil.map'
const MAP_MODULE_TYPE = 'map'
const RICH_TEXT_PLUGIN_ID = 'open-pencil.rich-text'
const RICH_TEXT_MODULE_TYPE = 'rich-text'
const HTML_PLUGIN_ID = 'open-pencil.html'
const HTML_MODULE_TYPE = 'html'
const VIDEO_PLUGIN_ID = 'open-pencil.video'
const VIDEO_MODULE_TYPE = 'video'
const TABLE_PLUGIN_ID = 'open-pencil.table'
const TABLE_MODULE_TYPE = 'table'
const SLIDE_MENU_PLUGIN_ID = 'open-pencil.slide-menu'
const SLIDE_MENU_MODULE_TYPE = 'slide-menu'

function pluginModuleItemTestId(pluginId: string, moduleType: string, mobile = false): string {
  return `toolbar-plugin-module-${pluginId}-${moduleType}${mobile ? '-mobile' : ''}`
}

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

async function pluginRuntimeState(page: Page, pluginId: string) {
  return page.evaluate(async (id) => {
    const { appPluginStore, appPluginStoreReady, appPluginStoreSnapshot } =
      await import('/src/app/plugins/index.ts')
    await appPluginStoreReady
    const plugin = appPluginStore
      .snapshot()
      .installed.find((candidate) => candidate.package.manifest.plugin.id === id)
    const { inspectInstalledPluginModuleCompatibility } = await import('/src/app/plugins/index.ts')
    const installedModules = appPluginStore
      .installedModules()
      .filter((module) => module.plugin.package.manifest.plugin.id === id)
    return {
      installed: Boolean(plugin),
      enabled: plugin?.enabled ?? false,
      blockedReason: plugin?.blockedReason ?? null,
      reactiveEnabled:
        appPluginStoreSnapshot.value.installed.find(
          (candidate) => candidate.package.manifest.plugin.id === id
        )?.enabled ?? false,
      modules: installedModules.map((module) => module.contribution.moduleType),
      compatible: installedModules.map(
        (module) => inspectInstalledPluginModuleCompatibility(module).ok
      )
    }
  }, pluginId)
}

async function installAndEnablePlugin(page: Page, pluginId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const { appPluginStore, appPluginStoreReady } = await import('/src/app/plugins/index.ts')
    await appPluginStoreReady
    const installed = appPluginStore
      .snapshot()
      .installed.find((plugin) => plugin.package.manifest.plugin.id === id)
    if (!installed) await appPluginStore.install(id)
    if (!installed?.enabled) await appPluginStore.setEnabled(id, true)
  }, pluginId)
}

test('inserts the enabled Map module from the desktop toolbar', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.getByTestId('toolbar-plugin-modules').click()
  await page.getByTestId(pluginModuleItemTestId(MAP_PLUGIN_ID, MAP_MODULE_TYPE)).click()
  await canvas.waitForRender()

  await expect
    .poll(async () => await canvasPluginModules(page))
    .toContainEqual({ pluginId: MAP_PLUGIN_ID, moduleType: MAP_MODULE_TYPE })
  canvas.assertNoErrors()
})

test('inserts and visually edits Rich Text only while its plugin is enabled', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.evaluate(async (pluginId) => {
    const { appPluginStore, appPluginStoreReady } = await import('/src/app/plugins/index.ts')
    await appPluginStoreReady
    const installed = appPluginStore
      .snapshot()
      .installed.find((plugin) => plugin.package.manifest.plugin.id === pluginId)
    if (!installed) await appPluginStore.install(pluginId)
    if (!installed?.enabled) await appPluginStore.setEnabled(pluginId, true)
  }, RICH_TEXT_PLUGIN_ID)
  await expect
    .poll(async () => await pluginRuntimeState(page, RICH_TEXT_PLUGIN_ID))
    .toEqual({
      installed: true,
      enabled: true,
      blockedReason: null,
      reactiveEnabled: true,
      modules: [RICH_TEXT_MODULE_TYPE],
      compatible: [true]
    })

  const richTextItem = page.getByTestId(
    pluginModuleItemTestId(RICH_TEXT_PLUGIN_ID, RICH_TEXT_MODULE_TYPE)
  )
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(richTextItem).toBeVisible()
  await richTextItem.click()
  await canvas.waitForRender()
  await expect
    .poll(async () => await canvasPluginModules(page))
    .toContainEqual({ pluginId: RICH_TEXT_PLUGIN_ID, moduleType: RICH_TEXT_MODULE_TYPE })

  await expect(page.getByTestId('rich-text-content-editor')).toBeVisible()
  const firstText = page.getByTestId('rich-text-inline-text').first()
  await firstText.fill('Edited visually')
  await firstText.blur()
  await page.getByRole('button', { name: 'Italic' }).first().click()
  await expect.poll(async () => await selectedModuleJson(page)).toContain('Edited visually')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('"type":"italic"')

  await page.evaluate(async (pluginId) => {
    const { appPluginStore } = await import('/src/app/plugins/index.ts')
    await appPluginStore.setEnabled(pluginId, false)
  }, RICH_TEXT_PLUGIN_ID)
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(richTextItem).toHaveCount(0)
  canvas.assertNoErrors()
})

test('installs, inserts, and previews edited HTML only while its plugin is enabled', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.evaluate(async (pluginId) => {
    const { appPluginStore, appPluginStoreReady } = await import('/src/app/plugins/index.ts')
    await appPluginStoreReady
    const installed = appPluginStore
      .snapshot()
      .installed.find((plugin) => plugin.package.manifest.plugin.id === pluginId)
    if (!installed) await appPluginStore.install(pluginId)
    if (!installed?.enabled) await appPluginStore.setEnabled(pluginId, true)
  }, HTML_PLUGIN_ID)
  await expect
    .poll(async () => await pluginRuntimeState(page, HTML_PLUGIN_ID))
    .toEqual({
      installed: true,
      enabled: true,
      blockedReason: null,
      reactiveEnabled: true,
      modules: [HTML_MODULE_TYPE],
      compatible: [true]
    })

  const htmlItem = page.getByTestId(pluginModuleItemTestId(HTML_PLUGIN_ID, HTML_MODULE_TYPE))
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(htmlItem).toBeVisible()
  await htmlItem.click()
  await canvas.waitForRender()
  await expect
    .poll(async () => await canvasPluginModules(page))
    .toContainEqual({ pluginId: HTML_PLUGIN_ID, moduleType: HTML_MODULE_TYPE })

  const editor = page.getByTestId('html-content-editor')
  await expect(editor).toBeVisible()
  const source = page.getByTestId('html-content-source')
  await source.fill(
    '<style>strong{color:rgb(220,38,38)}</style><main id="edited-html"><strong>Edited HTML</strong></main>'
  )
  await expect(
    page.frameLocator('[data-test-id="html-content-preview"]').locator('#edited-html')
  ).toHaveText('Edited HTML')
  await source.blur()
  await expect.poll(async () => await selectedModuleJson(page)).toContain('Edited HTML')

  await page.evaluate(async (pluginId) => {
    const { appPluginStore } = await import('/src/app/plugins/index.ts')
    await appPluginStore.setEnabled(pluginId, false)
  }, HTML_PLUGIN_ID)
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(htmlItem).toHaveCount(0)
  canvas.assertNoErrors()
})

test('installs and configures the reviewed Video module only while enabled', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await installAndEnablePlugin(page, VIDEO_PLUGIN_ID)
  await expect
    .poll(async () => await pluginRuntimeState(page, VIDEO_PLUGIN_ID))
    .toEqual({
      installed: true,
      enabled: true,
      blockedReason: null,
      reactiveEnabled: true,
      modules: [VIDEO_MODULE_TYPE],
      compatible: [true]
    })

  const videoItem = page.getByTestId(pluginModuleItemTestId(VIDEO_PLUGIN_ID, VIDEO_MODULE_TYPE))
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(videoItem).toBeVisible()
  await videoItem.click()
  await canvas.waitForRender()
  await expect
    .poll(async () => await canvasPluginModules(page))
    .toContainEqual({ pluginId: VIDEO_PLUGIN_ID, moduleType: VIDEO_MODULE_TYPE })

  const source = page.getByRole('textbox', { name: 'Video source' })
  await source.fill('https://cdn.example.com/demo.mp4')
  await source.blur()
  await expect
    .poll(async () => await selectedModuleJson(page))
    .toContain('https://cdn.example.com/demo.mp4')

  const autoplay = page.getByRole('checkbox', { name: 'Autoplay' })
  const muted = page.getByRole('checkbox', { name: 'Muted' })
  await autoplay.click()
  await expect(page.getByText('video config autoplay requires muted to be true')).toBeVisible()
  await expect(autoplay).not.toBeChecked()
  await muted.check()
  await expect(page.getByText('video config autoplay requires muted to be true')).toHaveCount(0)
  await autoplay.check()
  await expect.poll(async () => await selectedModuleJson(page)).toContain('"muted":true')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('"autoplay":true')

  await page.evaluate(async (pluginId) => {
    const { appPluginStore } = await import('/src/app/plugins/index.ts')
    await appPluginStore.setEnabled(pluginId, false)
  }, VIDEO_PLUGIN_ID)
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(videoItem).toHaveCount(0)
  canvas.assertNoErrors()
})

test('edits bounded structured Table cells and dimensions in its custom property editor', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await installAndEnablePlugin(page, TABLE_PLUGIN_ID)
  await expect
    .poll(async () => await pluginRuntimeState(page, TABLE_PLUGIN_ID))
    .toEqual({
      installed: true,
      enabled: true,
      blockedReason: null,
      reactiveEnabled: true,
      modules: [TABLE_MODULE_TYPE],
      compatible: [true]
    })

  const tableItem = page.getByTestId(pluginModuleItemTestId(TABLE_PLUGIN_ID, TABLE_MODULE_TYPE))
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(tableItem).toBeVisible()
  await tableItem.click()
  await canvas.waitForRender()
  await expect
    .poll(async () => await canvasPluginModules(page))
    .toContainEqual({ pluginId: TABLE_PLUGIN_ID, moduleType: TABLE_MODULE_TYPE })

  await expect(page.getByTestId('table-content-editor')).toBeVisible()
  const headerInputs = page.getByTestId('table-header-input')
  const cellInputs = page.getByTestId('table-cell-input')
  await headerInputs.first().fill('Project')
  await headerInputs.first().blur()
  await cellInputs.first().fill('Roadmap')
  await cellInputs.first().blur()

  await canvas.undo()
  await expect(cellInputs.first()).toHaveValue('Landing page')
  await expect.poll(async () => await selectedModuleJson(page)).not.toContain('Roadmap')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('Project')

  await cellInputs.first().fill('Roadmap')
  await cellInputs.first().blur()

  for (let index = 0; index < 9; index += 1) {
    await page.getByTestId('table-add-column').click()
  }
  await expect(headerInputs).toHaveCount(12)
  await expect(page.getByTestId('table-add-column')).toBeDisabled()

  await page.getByTestId('table-add-row').click()
  await expect(cellInputs).toHaveCount(48)
  await page.getByTestId('table-delete-column').last().click()
  await page.getByTestId('table-delete-row').last().click()
  await expect(headerInputs).toHaveCount(11)
  await expect(cellInputs).toHaveCount(33)
  await expect.poll(async () => await selectedModuleJson(page)).toContain('"columns"')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('Project')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('Roadmap')

  await page.evaluate(async (pluginId) => {
    const { appPluginStore } = await import('/src/app/plugins/index.ts')
    await appPluginStore.setEnabled(pluginId, false)
  }, TABLE_PLUGIN_ID)
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(tableItem).toHaveCount(0)
  canvas.assertNoErrors()
})

test('configures a four-direction Slide Menu only while its plugin is enabled', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await installAndEnablePlugin(page, SLIDE_MENU_PLUGIN_ID)
  await expect
    .poll(async () => await pluginRuntimeState(page, SLIDE_MENU_PLUGIN_ID))
    .toEqual({
      installed: true,
      enabled: true,
      blockedReason: null,
      reactiveEnabled: true,
      modules: [SLIDE_MENU_MODULE_TYPE],
      compatible: [true]
    })

  const menuItem = page.getByTestId(
    pluginModuleItemTestId(SLIDE_MENU_PLUGIN_ID, SLIDE_MENU_MODULE_TYPE)
  )
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(menuItem).toBeVisible()
  await menuItem.click()
  await canvas.waitForRender()
  await expect
    .poll(async () => await canvasPluginModules(page))
    .toContainEqual({ pluginId: SLIDE_MENU_PLUGIN_ID, moduleType: SLIDE_MENU_MODULE_TYPE })

  await expect(page.getByTestId('slide-menu-items-editor')).toBeVisible()
  await page
    .getByTestId('module-property-input')
    .and(page.locator('[data-module-path="presentation"]'))
    .selectOption('dialog')
  await page
    .getByTestId('module-property-input')
    .and(page.locator('[data-module-path="direction"]'))
    .selectOption('bottom')
  const trigger = page
    .getByTestId('module-property-input')
    .and(page.locator('[data-module-path="triggerLabel"]'))
  await trigger.fill('Open details')
  await trigger.blur()

  await page.getByTestId('slide-menu-add-item').click()
  const labels = page.getByTestId('slide-menu-item-label')
  const hrefs = page.getByTestId('slide-menu-item-href')
  await labels.last().fill('Documentation')
  await labels.last().blur()
  await hrefs.last().fill('/docs')
  await hrefs.last().blur()
  await hrefs.first().fill(['javascript', 'alert(1)'].join(':'))
  await hrefs.first().blur()
  await expect(page.getByText(/must be a safe bounded href/)).toHaveCount(1)
  await hrefs.first().fill('/')
  await hrefs.first().blur()
  await expect(page.getByText(/must be a safe bounded href/)).toHaveCount(0)

  await expect.poll(async () => await selectedModuleJson(page)).toContain('"presentation":"dialog"')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('"direction":"bottom"')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('Open details')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('Documentation')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('/docs')

  await page.evaluate(async (pluginId) => {
    const { appPluginStore } = await import('/src/app/plugins/index.ts')
    await appPluginStore.setEnabled(pluginId, false)
  }, SLIDE_MENU_PLUGIN_ID)
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(menuItem).toHaveCount(0)
  canvas.assertNoErrors()
})

test('uses the same plugin module menu on the mobile toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 })
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await expect(page.getByTestId('mobile-toolbar')).toBeVisible()
  await page.getByTestId('toolbar-plugin-modules-mobile').click()
  await page.getByTestId(pluginModuleItemTestId(MAP_PLUGIN_ID, MAP_MODULE_TYPE, true)).click()
  await canvas.waitForRender()

  await expect
    .poll(async () => await canvasPluginModules(page))
    .toContainEqual({ pluginId: MAP_PLUGIN_ID, moduleType: MAP_MODULE_TYPE })
  canvas.assertNoErrors()
})
