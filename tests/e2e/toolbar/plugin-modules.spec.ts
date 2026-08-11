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
const DROPDOWN_MENU_PLUGIN_ID = 'open-pencil.dropdown-menu'
const DROPDOWN_MENU_MODULE_TYPE = 'dropdown-menu'
const MODAL_PLUGIN_ID = 'open-pencil.modal'
const MODAL_MODULE_TYPE = 'modal'

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
  const presentation = page
    .getByTestId('module-property-input')
    .and(page.locator('[data-module-path="presentation"]'))
  await presentation.selectOption('dialog')
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
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await expect(presentation).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(presentation).toHaveCSS('color', 'rgb(31, 35, 40)')
  for (const input of [labels.first(), hrefs.first()]) {
    await expect(input).toHaveCSS('background-color', 'rgb(31, 35, 40)')
    await expect(input).toHaveCSS('color', 'rgb(255, 255, 255)')
  }
  await labels.first().focus()
  await expect(labels.first()).toBeFocused()
  await expect(labels.first()).toHaveCSS('border-color', 'rgb(37, 99, 235)')
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  for (const input of [labels.first(), hrefs.first()]) {
    await expect(input).toHaveCSS('background-color', 'rgb(240, 240, 240)')
    await expect(input).toHaveCSS('color', 'rgb(30, 30, 30)')
  }
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

test('installs and edits a flat accessible Dropdown Menu only while enabled', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await expect
    .poll(async () => await pluginRuntimeState(page, DROPDOWN_MENU_PLUGIN_ID))
    .toEqual({
      installed: false,
      enabled: false,
      blockedReason: null,
      reactiveEnabled: false,
      modules: [],
      compatible: []
    })

  await installAndEnablePlugin(page, DROPDOWN_MENU_PLUGIN_ID)
  await expect
    .poll(async () => await pluginRuntimeState(page, DROPDOWN_MENU_PLUGIN_ID))
    .toEqual({
      installed: true,
      enabled: true,
      blockedReason: null,
      reactiveEnabled: true,
      modules: [DROPDOWN_MENU_MODULE_TYPE],
      compatible: [true]
    })

  const dropdownItem = page.getByTestId(
    pluginModuleItemTestId(DROPDOWN_MENU_PLUGIN_ID, DROPDOWN_MENU_MODULE_TYPE)
  )
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(dropdownItem).toBeVisible()
  await dropdownItem.click()
  await canvas.waitForRender()
  await expect
    .poll(async () => await canvasPluginModules(page))
    .toContainEqual({ pluginId: DROPDOWN_MENU_PLUGIN_ID, moduleType: DROPDOWN_MENU_MODULE_TYPE })

  await expect(page.getByTestId('dropdown-menu-items-editor')).toBeVisible()
  const triggerModeInput = page
    .getByTestId('module-property-input')
    .and(page.locator('[data-module-path="triggerMode"]'))
  const placementInput = page
    .getByTestId('module-property-input')
    .and(page.locator('[data-module-path="placement"]'))
  await page.getByRole('menuitem', { name: 'View', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Language' }).hover()
  await page.getByRole('menuitemcheckbox', { name: 'Deutsch' }).click()
  await expect(triggerModeInput.locator('option')).toHaveText(['Klick', 'Beim Darüberfahren'])
  await expect(placementInput.locator('option')).toHaveText([
    'Unten links',
    'Unten mittig',
    'Unten rechts',
    'Oben links',
    'Oben mittig',
    'Oben rechts',
    'Links oben',
    'Links mittig',
    'Links unten',
    'Rechts oben',
    'Rechts mittig',
    'Rechts unten'
  ])
  await triggerModeInput.selectOption('hover')
  await placementInput.selectOption('rightBottom')

  const separators = page.getByTestId('dropdown-menu-separator-row')
  await page.getByTestId('dropdown-menu-add-separator').click()
  await expect(separators).toHaveCount(2)
  await page.getByTestId('dropdown-menu-add-item').click()

  const summaries = page.getByTestId('dropdown-menu-item-summary')
  await summaries.last().click()
  const labels = page.getByTestId('dropdown-menu-item-label')
  const hrefs = page.getByTestId('dropdown-menu-item-href')
  const shortcuts = page.getByTestId('dropdown-menu-item-shortcut')
  await labels.last().fill('Billing')
  await labels.last().blur()
  await hrefs.last().fill(['javascript', 'alert(1)'].join(':'))
  await hrefs.last().blur()
  await expect(page.getByText(/must be empty or a safe bounded href/)).toHaveCount(1)
  await hrefs.last().fill('/billing')
  await hrefs.last().blur()
  await shortcuts.last().fill('⌘B')
  await shortcuts.last().blur()
  await page.getByTestId('dropdown-menu-item-disabled').last().check()
  await page.getByTestId('dropdown-menu-item-danger').last().check()

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await expect(labels.first()).toHaveCSS('background-color', 'rgb(31, 35, 40)')
  await expect(labels.first()).toHaveCSS('color', 'rgb(255, 255, 255)')
  await labels.first().focus()
  await expect(labels.first()).toBeFocused()
  await expect(labels.first()).toHaveCSS('border-color', 'rgb(37, 99, 235)')
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
  await expect(labels.first()).toHaveCSS('background-color', 'rgb(240, 240, 240)')
  await expect(labels.first()).toHaveCSS('color', 'rgb(30, 30, 30)')

  await expect.poll(async () => await selectedModuleJson(page)).toContain('"triggerMode":"hover"')
  await expect
    .poll(async () => await selectedModuleJson(page))
    .toContain('"placement":"rightBottom"')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('Billing')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('/billing')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('"disabled":true')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('"danger":true')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('⌘B')

  await separators.last().getByTestId('dropdown-menu-delete-entry').click()
  await expect(separators).toHaveCount(1)
  await expect(summaries.last()).toBeFocused()

  await page.evaluate(async (pluginId) => {
    const { appPluginStore } = await import('/src/app/plugins/index.ts')
    await appPluginStore.setEnabled(pluginId, false)
  }, DROPDOWN_MENU_PLUGIN_ID)
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(dropdownItem).toHaveCount(0)
  canvas.assertNoErrors()
})

test('installs and configures the bounded Modal module only while enabled', async ({ page }) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await installAndEnablePlugin(page, MODAL_PLUGIN_ID)
  await expect
    .poll(async () => await pluginRuntimeState(page, MODAL_PLUGIN_ID))
    .toEqual({
      installed: true,
      enabled: true,
      blockedReason: null,
      reactiveEnabled: true,
      modules: [MODAL_MODULE_TYPE],
      compatible: [true]
    })

  const modalItem = page.getByTestId(pluginModuleItemTestId(MODAL_PLUGIN_ID, MODAL_MODULE_TYPE))
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(modalItem).toBeVisible()
  await modalItem.click()
  await canvas.waitForRender()
  await expect
    .poll(async () => await canvasPluginModules(page))
    .toContainEqual({ pluginId: MODAL_PLUGIN_ID, moduleType: MODAL_MODULE_TYPE })

  const content = page.getByTestId('multiline-module-text-source')
  await expect(content).toHaveAttribute('maxlength', '4000')
  await content.fill('A bounded multiline modal body.\nSecond line.')
  await content.blur()
  const showTriggerLabel = page
    .getByTestId('module-property-input')
    .and(page.locator('[data-module-path="showTriggerLabel"]'))
  await showTriggerLabel.uncheck()
  const panelWidthField = page
    .getByTestId('module-property-input')
    .and(page.locator('[data-module-path="panelWidth"]'))
  await panelWidthField.click()
  const panelWidth = panelWidthField.getByRole('spinbutton', { name: 'Panel width' })
  await panelWidth.fill('480')
  await panelWidth.press('Enter')

  await expect.poll(async () => await selectedModuleJson(page)).toContain('A bounded multiline')
  await expect
    .poll(async () => await selectedModuleJson(page))
    .toContain('"showTriggerLabel":false')
  await expect.poll(async () => await selectedModuleJson(page)).toContain('"panelWidth":480')

  await page.evaluate(async (pluginId) => {
    const { appPluginStore } = await import('/src/app/plugins/index.ts')
    await appPluginStore.setEnabled(pluginId, false)
  }, MODAL_PLUGIN_ID)
  await page.getByTestId('toolbar-plugin-modules').click()
  await expect(modalItem).toHaveCount(0)
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
