import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup()

function designPanel() {
  return editor.page.getByTestId('design-panel-single')
}

function workspace(id: 'classic' | 'focused' | 'studio') {
  return editor.page.getByTestId(`design-panel-workspace-${id}`)
}

function section(id: string) {
  return editor.page.getByTestId(`inspector-section-${id}`)
}

function sectionTrigger(id: string) {
  return editor.page.getByTestId(`inspector-section-trigger-${id}`)
}

function sectionHide(id: string) {
  return editor.page.getByTestId(`inspector-section-hide-${id}`)
}

async function visibleSectionOrder(): Promise<string[]> {
  return designPanel()
    .getByTestId(/^inspector-section-(?!trigger-|content-)/)
    .evaluateAll((elements) =>
      elements
        .filter((element) => getComputedStyle(element).display !== 'none')
        .map((element) => element.getAttribute('data-test-id')?.replace('inspector-section-', ''))
        .filter((id): id is string => id !== undefined)
    )
}

async function studioRowOrder(): Promise<string[]> {
  return editor.page
    .getByTestId('design-panel-studio-panel')
    .getByTestId(/^design-panel-studio-row-(?!.*-(?:toggle|up|down)$)/)
    .evaluateAll((elements) =>
      elements
        .map((element) =>
          element.getAttribute('data-test-id')?.replace('design-panel-studio-row-', '')
        )
        .filter((id): id is string => id !== undefined)
    )
}

test.beforeEach(async () => {
  await editor.canvas.clearCanvas()
  await editor.canvas.drawRect(120, 120, 100, 80)
  await editor.canvas.waitForRender()
})

test('defaults to the Classic workspace and preserves its section order', async () => {
  await expect(workspace('classic')).toHaveAttribute('aria-pressed', 'true')
  await expect(workspace('focused')).toHaveAttribute('aria-pressed', 'false')
  await expect(workspace('studio')).toHaveAttribute('aria-pressed', 'false')
  expect(await visibleSectionOrder()).toEqual([
    'position',
    'layout',
    'appearance',
    'motion',
    'export',
    'lowcode-advanced'
  ])
})

test('Focused hides secondary sections until Show all or search reveals them', async () => {
  const classicPosition = sectionTrigger('position')
  await expect(classicPosition).toHaveAttribute('aria-expanded', 'true')
  await classicPosition.click()
  await expect(classicPosition).toHaveAttribute('aria-expanded', 'false')

  await workspace('focused').click()
  await expect(workspace('focused')).toHaveAttribute('aria-pressed', 'true')
  await expect(section('lowcode-advanced')).not.toBeVisible()

  const showAll = editor.page.getByTestId('design-panel-focused-show-all')
  await expect(showAll).toHaveAttribute('aria-checked', 'false')
  await showAll.click()
  await expect(showAll).toHaveAttribute('aria-checked', 'true')
  await expect(section('lowcode-advanced')).toBeVisible()

  await showAll.click()
  await expect(section('lowcode-advanced')).not.toBeVisible()

  const filter = editor.page.getByTestId('inspector-filter-input')
  await filter.fill('advanced')
  await expect(section('lowcode-advanced')).toBeVisible()
  await expect(sectionTrigger('lowcode-advanced')).toHaveAttribute('aria-expanded', 'true')

  await editor.page.getByTestId('inspector-filter-clear').click()
  await expect(section('lowcode-advanced')).not.toBeVisible()

  await workspace('classic').click()
  await expect(sectionTrigger('position')).toHaveAttribute('aria-expanded', 'false')
})

test('Studio reorders, hides, persists, resets, and does not pollute Classic folding', async () => {
  await workspace('classic').click()
  if ((await sectionTrigger('position').getAttribute('aria-expanded')) === 'true') {
    await sectionTrigger('position').click()
  }
  await expect(sectionTrigger('position')).toHaveAttribute('aria-expanded', 'false')

  await workspace('studio').click()
  await expect(workspace('studio')).toHaveAttribute('aria-pressed', 'true')
  await expect(sectionTrigger('position')).toHaveAttribute('aria-expanded', 'true')

  await editor.page.getByTestId('design-panel-studio-config').click()
  await expect(editor.page.getByTestId('design-panel-studio-panel')).toBeVisible()

  const initialRows = await studioRowOrder()
  expect(initialRows.indexOf('position')).toBeLessThan(initialRows.indexOf('layout'))

  await editor.page.getByTestId('design-panel-studio-row-layout-up').click()
  const movedRows = await studioRowOrder()
  expect(movedRows.indexOf('layout')).toBeLessThan(movedRows.indexOf('position'))

  const movedSections = await visibleSectionOrder()
  expect(movedSections.indexOf('layout')).toBeLessThan(movedSections.indexOf('position'))

  const layoutToggle = editor.page.getByTestId('design-panel-studio-row-layout-toggle')
  await expect(layoutToggle).toHaveAttribute('aria-pressed', 'true')
  await layoutToggle.click()
  await expect(layoutToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(section('layout')).not.toBeVisible()

  await editor.page.keyboard.press('Escape')
  await editor.page.setViewportSize({ width: 800, height: 800 })
  const workspaceBar = editor.page.getByTestId('design-panel-workspace-bar')
  await expect
    .poll(() => workspaceBar.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true)

  await editor.page.reload()
  await editor.canvas.waitForInit()
  await editor.canvas.drawRect(120, 120, 100, 80)
  await editor.canvas.waitForRender()

  await expect(workspace('studio')).toHaveAttribute('aria-pressed', 'true')
  await expect(section('layout')).not.toBeVisible()
  await editor.page.getByTestId('design-panel-studio-config').click()
  await expect(editor.page.getByTestId('design-panel-studio-row-layout-toggle')).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  const persistedRows = await studioRowOrder()
  expect(persistedRows.indexOf('layout')).toBeLessThan(persistedRows.indexOf('position'))

  await editor.page.getByTestId('design-panel-studio-reset').click()
  await expect(editor.page.getByTestId('design-panel-studio-row-layout-toggle')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(section('layout')).toBeVisible()
  const resetRows = await studioRowOrder()
  expect(resetRows.indexOf('position')).toBeLessThan(resetRows.indexOf('layout'))

  await editor.page.keyboard.press('Escape')
  await workspace('classic').click()
  await expect(sectionTrigger('position')).toHaveAttribute('aria-expanded', 'false')
})

test('Studio hides a section inline and restores it from the workspace configuration', async () => {
  await expect(sectionHide('layout')).toHaveCount(0)

  await workspace('focused').click()
  await expect(section('layout')).toBeVisible()
  await expect(sectionHide('layout')).toHaveCount(0)

  await workspace('studio').click()
  const studioConfig = editor.page.getByTestId('design-panel-studio-config')
  await studioConfig.click()
  await editor.page.getByTestId('design-panel-studio-reset').click()
  await editor.page.keyboard.press('Escape')

  const inlineHide = sectionHide('layout')
  await expect(section('layout')).toBeVisible()
  await expect(inlineHide).toBeVisible()
  await inlineHide.click()

  await expect(section('layout')).not.toBeVisible()
  await expect(studioConfig).toBeFocused()

  await studioConfig.click()
  const layoutToggle = editor.page.getByTestId('design-panel-studio-row-layout-toggle')
  await expect(layoutToggle).toHaveAttribute('aria-pressed', 'false')
  await layoutToggle.click()

  await expect(layoutToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(section('layout')).toBeVisible()
  await expect(sectionHide('layout')).toBeVisible()
})

test('Appearance settings switches and persists the design panel workspace', async () => {
  await editor.page.getByTestId('app-settings-trigger').click()
  await editor.page.getByTestId('settings-section-appearance').click()

  const focusedSetting = editor.page.getByTestId('settings-design-panel-workspace-focused')
  await focusedSetting.click()
  await expect(focusedSetting).toHaveAttribute('data-selected', 'true')
  await expect(workspace('focused')).toHaveAttribute('aria-pressed', 'true')
  await editor.page.getByTestId('app-settings-done').click()

  await editor.page.reload()
  await editor.canvas.waitForInit()
  await editor.canvas.drawRect(120, 120, 100, 80)
  await editor.canvas.waitForRender()
  await expect(workspace('focused')).toHaveAttribute('aria-pressed', 'true')

  await workspace('classic').click()
})
