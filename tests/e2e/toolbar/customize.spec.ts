import { expect, test, type Page } from '@playwright/test'

import { EDITOR_TOOLS } from '@open-pencil/core/editor'

import type { ToolbarLayout } from '@/app/editor/toolbar/layout'

import { CanvasHelper } from '#tests/helpers/canvas'
import {
  toolbarFlyoutItemTestId,
  toolbarFlyoutTestId,
  toolbarToolTestId
} from '#tests/helpers/test-ids'

/** The tools the toolbar shows, in order: a flyout counts as the tool its button shows. */
function toolbarOrder(page: Page) {
  return page
    .getByTestId('toolbar')
    .locator('button[aria-pressed]')
    .evaluateAll((buttons) =>
      buttons.flatMap((button) => button.getAttribute('data-test-id') ?? [])
    )
}

test('the toolbar hides, reorders and regroups tools from Settings and keeps the layout', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.getByTestId('toolbar').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Customize toolbar…' }).click()
  const settings = page.getByTestId('settings-toolbar-panel')
  await expect(settings).toBeVisible()

  await settings.getByRole('switch', { name: 'Show Pen', exact: true }).click()
  await settings.getByRole('switch', { name: 'Show Pencil', exact: true }).click()
  // Dropping Comment onto Hand puts both in one menu; Text's grip moves it with the keyboard.
  await settings
    .getByRole('button', { name: 'Reorder Comment' })
    .dragTo(settings.locator('[data-entry="HAND"]'))
  await settings.getByRole('button', { name: 'Reorder Text', exact: true }).press('ArrowUp')
  const reordered = await page.evaluate(async () => {
    const path = '/src/app/settings/preferences/store.ts'
    const { appPreferences } = await import(path)
    const groups: ToolbarLayout['groups'] = appPreferences.value.toolbar.groups
    return {
      text: groups.findIndex((group) => group.includes('TEXT')),
      pen: groups.findIndex((group) => group.includes('PEN'))
    }
  })
  expect(reordered.text).toBeLessThan(reordered.pen)
  await page.getByTestId('app-settings-done').click()
  await expect(page.getByTestId('app-settings-dialog')).toBeHidden()

  const expectCustomized = async () => {
    await expect(page.getByTestId(toolbarToolTestId('PEN'))).toHaveCount(0)
    await expect(page.getByTestId(toolbarToolTestId('PENCIL'))).toHaveCount(0)
    expect(await toolbarOrder(page)).toEqual(
      EDITOR_TOOLS.filter((tool) => tool.key !== 'PEN' && tool.key !== 'COMMENT').map((tool) =>
        toolbarToolTestId(tool.key)
      )
    )
    await page.getByTestId(toolbarFlyoutTestId('HAND')).click()
    await page.getByTestId(toolbarFlyoutItemTestId('COMMENT')).click()
    await expect(page.getByTestId(toolbarToolTestId('COMMENT'))).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  }
  await expectCustomized()

  await page.reload()
  await canvas.waitForInit()
  await expectCustomized()

  await canvas.pressKey('p')
  expect(
    await page.evaluate(() => {
      if (!window.openPencil?.getStore) throw new Error('Editor test API is unavailable')
      return window.openPencil?.getStore?.().state.activeTool
    })
  ).toBe('PEN')

  await page.getByTestId('toolbar').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Customize toolbar…' }).click()
  await page.getByRole('button', { name: 'Reset to default' }).click()
  await page.getByTestId('app-settings-done').click()
  await expect(page.getByTestId(toolbarToolTestId('PEN'))).toBeVisible()
  canvas.assertNoErrors()
})
