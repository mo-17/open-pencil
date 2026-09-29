import type { Locator, Page } from '@playwright/test'

import { expect, test, expectInViewport } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

async function setupRadio(page: Page) {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  const ids = await page.evaluate(() => {
    const editor = window.openPencil.getStore()
    const graph = editor.graph
    graph.updateNode(editor.state.currentPageId, {
      state: [{ id: 'plan', name: 'plan', type: 'string', defaultValue: 'Team' }]
    })
    const first = graph.createNode('RADIO', editor.state.currentPageId, {
      name: 'Plan radio',
      x: 100,
      y: 100,
      width: 320,
      height: 88,
      interactiveProps: { options: ['Personal', 'Team'], value: 'Team', groupName: 'plan' }
    })
    const second = graph.createNode('RADIO', editor.state.currentPageId, {
      name: 'Other radio',
      x: 100,
      y: 230,
      width: 320,
      height: 88,
      interactiveProps: { options: ['Daily', 'Weekly'], value: 'Daily', groupName: 'schedule' }
    })
    editor.select([first.id])
    return { first: first.id, second: second.id }
  })
  const section = page.getByTestId('inspector-section-lowcode-control')
  await expect(section).toBeVisible()
  return { ...ids, canvas, section }
}

async function props(page: Page, id: string) {
  return page.evaluate((id) => window.openPencil.getStore().graph.getNode(id)?.interactiveProps, id)
}

async function inputContrast(input: Locator): Promise<number> {
  return input.evaluate((element) => {
    const style = getComputedStyle(element)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Missing color context')
    const luminance = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const rgba = context.getImageData(0, 0, 1, 1).data
      if (rgba[3] !== 255) throw new Error(`Expected opaque input color: ${color}`)
      const channels = Array.from(rgba)
        .slice(0, 3)
        .map((value) => {
          const channel = value / 255
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const foreground = luminance(style.color)
    const background = luminance(style.backgroundColor)
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
  })
}

test('radio options are visible first in classic and focused inspectors', async ({ page }) => {
  const { section, canvas } = await setupRadio(page)
  for (const mode of ['classic', 'focused']) {
    await page.getByTestId(`design-panel-workspace-${mode}`).click()
    const options = section.getByTestId('lowcode-interactive-option-input')
    await expect(options).toHaveCount(2)
    await expectInViewport(page, options.first())
    await expectInViewport(page, section.getByTestId('lowcode-interactive-value'))
    await expect(page.getByTestId('lowcode-radio-options')).toHaveCount(1)
    const below = page.getByTestId('inspector-section-interaction-states')
    const optionBox = await options.first().boundingBox()
    const interactionBox = await below.boundingBox()
    expect(optionBox?.y).toBeLessThan(interactionBox?.y ?? Number.POSITIVE_INFINITY)
  }
  await page.screenshot({ path: test.info().outputPath('panel-focused.png') })
  canvas.assertNoErrors()
})

test('radio option edits preserve the default atomically and leave bound state untouched', async ({
  page
}) => {
  const { first, section, canvas } = await setupRadio(page)
  const inputs = section.getByTestId('lowcode-interactive-option-input')
  await inputs.nth(1).fill('Business')
  await inputs.nth(1).press('Enter')
  expect(await props(page, first)).toMatchObject({
    options: ['Personal', 'Business'],
    value: 'Business'
  })
  await expect(section.getByTestId('lowcode-interactive-value')).toHaveText('Business')
  await page.evaluate(() => window.openPencil.getStore().undo.undo())
  await expect(inputs.nth(1)).toHaveValue('Team')
  await expect(section.getByTestId('lowcode-interactive-value')).toHaveText('Team')
  await section.getByTestId('lowcode-interactive-option-add').click()
  await expect(inputs).toHaveCount(3)
  await inputs.nth(2).fill('__openpencil_default__')
  await inputs.nth(2).press('Enter')
  await section.getByTestId('lowcode-interactive-value').click()
  await page.getByRole('option', { name: '__openpencil_default__', exact: true }).click()
  expect((await props(page, first))?.value).toBe('__openpencil_default__')
  await section.getByTestId('lowcode-interactive-option-remove').nth(2).click()
  await expect(inputs).toHaveCount(2)
  expect((await props(page, first))?.value).toBeUndefined()
  await expect(section.getByTestId('lowcode-interactive-value')).toHaveText('(none)')
  await section.getByTestId('lowcode-interactive-groupName').fill('renamed-plan')
  await section.getByTestId('lowcode-interactive-groupName').press('Enter')
  expect((await props(page, first))?.groupName).toBe('renamed-plan')
  await section.getByTestId('lowcode-value-binding-select').selectOption('state:plan')
  await expect(section.getByTestId('lowcode-interactive-value')).toBeDisabled()
  await expect(section.getByTestId('lowcode-radio-bound-hint')).toContainText('bound value')
  await inputs.nth(1).fill('Company')
  await inputs.nth(1).press('Enter')
  const bound = await page.evaluate((id) => {
    const editor = window.openPencil.getStore()
    return {
      binding: editor.graph.getNode(id)?.bindings?.value,
      state: editor.graph.getNode(editor.state.currentPageId)?.state
    }
  }, first)
  expect(bound.binding).toEqual({ kind: 'ref', stateId: 'plan' })
  expect(bound.state).toEqual([{ id: 'plan', name: 'plan', type: 'string', defaultValue: 'Team' }])
  await section.getByTestId('lowcode-value-binding-select').selectOption('')
  await expect(section.getByTestId('lowcode-interactive-value')).toBeEnabled()
  await expect(section.getByTestId('lowcode-radio-bound-hint')).toHaveCount(0)
  canvas.assertNoErrors()
})

test('late option change after selection switches cannot edit either radio', async ({ page }) => {
  const { first, second, section, canvas } = await setupRadio(page)
  const input = section.getByTestId('lowcode-interactive-option-input').first()
  await input.fill('Uncommitted old draft')
  await input.evaluate((element, secondId) => {
    window.openPencil.getStore().select([secondId])
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, second)
  await expect(section.getByTestId('lowcode-interactive-option-input').first()).toHaveValue('Daily')
  expect(await props(page, first)).toMatchObject({ options: ['Personal', 'Team'], value: 'Team' })
  expect(await props(page, second)).toMatchObject({ options: ['Daily', 'Weekly'], value: 'Daily' })
  canvas.assertNoErrors()
})

test('form overview reveals and focuses a hidden collapsed radio section without saving the reveal', async ({
  page
}) => {
  const { first, second, section, canvas } = await setupRadio(page)
  const formId = await page.evaluate((id) => {
    const editor = window.openPencil.getStore()
    const form = editor.graph.createNode('FORM', editor.state.currentPageId, {
      name: 'Plan form',
      width: 400,
      height: 200
    })
    editor.graph.reparentNode(id, form.id)
    return form.id
  }, first)
  await page.getByTestId('design-panel-workspace-studio').click()
  await page.getByTestId('inspector-section-trigger-lowcode-control').click()
  await expect(section).toHaveAttribute('data-state', 'closed')
  await page.getByTestId('inspector-section-hide-lowcode-control').click()
  await expect(section).not.toBeVisible()
  await page.evaluate((id) => window.openPencil.getStore().select([id]), formId)
  const before = await page.evaluate(() =>
    JSON.stringify(window.openPencil.getStore().graph.getAllNodes())
  )
  await page.getByTestId('form-overview-bindings').click()
  await expect(section).toBeVisible()
  await expect(section).toHaveAttribute('data-state', 'open')
  await expect(section.getByTestId('lowcode-value-binding-select')).toBeFocused()
  await expect(section).toHaveAttribute('data-lowcode-focus-highlighted', 'true')
  expect(
    await page.evaluate(() => JSON.stringify(window.openPencil.getStore().graph.getAllNodes()))
  ).toBe(before)
  await page.evaluate((id) => window.openPencil.getStore().select([id]), second)
  await expect(section).not.toBeVisible()
  canvas.assertNoErrors()
})

for (const theme of ['dark', 'light']) {
  test.describe(`${theme} theme`, () => {
    test.use({
      storageState: {
        cookies: [],
        origins: [
          {
            origin: `http://localhost:${process.env.OPENPENCIL_TEST_PORT ?? '1420'}`,
            localStorage: [
              { name: 'open-pencil:theme', value: theme },
              { name: 'open-pencil-locale', value: 'zh-CN' }
            ]
          }
        ]
      }
    })
    test(`radio inputs retain readable text in ${theme} theme`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1100 })
      const { first, section, canvas } = await setupRadio(page)
      await page.evaluate((id) => {
        const editor = window.openPencil.getStore()
        editor.updateNode(id, {
          interactiveProps: { options: ['个人', '团队'], value: '团队', groupName: 'plan' },
          bindings: { value: { kind: 'ref', stateId: 'plan' } }
        })
      }, first)
      const option = section.getByTestId('lowcode-interactive-option-input').first()
      await expect(option).toHaveValue('个人')
      await expect(section.getByTestId('lowcode-radio-bound-hint')).toContainText('绑定值')
      const contrast = await inputContrast(option)
      expect(contrast).toBeGreaterThanOrEqual(4.5)
      await test.info().attach(`panel-${theme}-contrast`, {
        body: JSON.stringify({ theme, contrast }, null, 2),
        contentType: 'application/json'
      })
      await section.screenshot({ path: test.info().outputPath(`panel-${theme}-zh.png`) })
      canvas.assertNoErrors()
    })
  })
}
