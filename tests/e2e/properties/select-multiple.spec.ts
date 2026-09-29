import { expect, test } from '@playwright/test'

import {
  createSelectPropertiesFixture,
  prepareSelectPropertiesEditor,
  readSelectProperties
} from '#tests/helpers/lowcode/select-properties'
import { deferContentCommit } from '#tests/helpers/plugins/content-components'

test('SELECT multiple defaults, conversion to single and undo stay atomic in the design panel', async ({
  page
}) => {
  const canvas = await prepareSelectPropertiesEditor(page)
  const { first } = await createSelectPropertiesFixture(page)
  const panel = page.locator('[data-property="lowcode-select-options"]')
  const multiple = panel.getByRole('checkbox', { name: 'Select multiple options', exact: true })
  await expect(multiple).not.toBeChecked()
  await multiple.check()
  await expect(panel.getByRole('checkbox', { name: 'Beta', exact: true })).toBeChecked()
  await expect(panel.getByRole('checkbox', { name: 'Unavailable', exact: true })).toBeDisabled()
  await expect
    .poll(() => readSelectProperties(page, first))
    .toMatchObject({
      multiple: true,
      value: ['b']
    })
  await panel.getByRole('checkbox', { name: 'Alpha', exact: true }).check()
  await expect
    .poll(() => readSelectProperties(page, first))
    .toMatchObject({
      multiple: true,
      value: ['b', 'a']
    })
  await panel.getByRole('checkbox', { name: 'Beta', exact: true }).uncheck()
  await multiple.uncheck()
  await expect(
    panel.getByRole('combobox', { name: 'Default selected', exact: true })
  ).toContainText('Alpha (a)')
  await expect
    .poll(() => readSelectProperties(page, first))
    .toMatchObject({
      multiple: false,
      value: 'a'
    })
  await page.evaluate(() => window.openPencil?.getStore?.().undo.undo())
  await expect(multiple).toBeChecked()
  await expect(panel.getByRole('checkbox', { name: 'Alpha', exact: true })).toBeChecked()
  await expect(panel.getByRole('checkbox', { name: 'Beta', exact: true })).not.toBeChecked()
  await expect
    .poll(() => readSelectProperties(page, first))
    .toMatchObject({
      multiple: true,
      value: ['a']
    })
  await page.evaluate(() => window.openPencil?.getStore?.().undo.undo())
  await expect(panel.getByRole('checkbox', { name: 'Beta', exact: true })).toBeChecked()
  await expect
    .poll(() => readSelectProperties(page, first))
    .toMatchObject({
      value: ['b', 'a']
    })
  canvas.assertNoErrors()
})

test('SELECT prevents bound mode edits and rejects a delayed option commit after changing layers', async ({
  page
}) => {
  const canvas = await prepareSelectPropertiesEditor(page)
  const ids = await createSelectPropertiesFixture(page)
  const panel = page.locator('[data-property="lowcode-select-options"]')
  const beforeFirst = await readSelectProperties(page, ids.first)
  const beforeSecond = await readSelectProperties(page, ids.second)
  const label = panel.getByRole('textbox', { name: 'Display label 1', exact: true })
  await label.fill('Late label from the previous node')
  const pending = await deferContentCommit(label)
  try {
    await page.locator(`[data-node-id="${ids.second}"]`).getByTestId('layers-item').click()
    await expect(label).toHaveValue('East')
    await pending.deliver()
    await expect.poll(() => readSelectProperties(page, ids.first)).toEqual(beforeFirst)
    await expect.poll(() => readSelectProperties(page, ids.second)).toEqual(beforeSecond)
    await expect(label).toHaveValue('East')
  } finally {
    await pending.dispose()
  }
  await page.locator(`[data-node-id="${ids.bound}"]`).getByTestId('layers-item').click()
  const multiple = panel.getByRole('checkbox', { name: 'Select multiple options', exact: true })
  await expect(multiple).toBeChecked()
  await expect(multiple).toBeDisabled()
  await expect(panel.getByRole('checkbox', { name: 'Bound alpha', exact: true })).toBeDisabled()
  await expect(panel.getByRole('checkbox', { name: 'Bound beta', exact: true })).toBeDisabled()
  await expect(panel).toContainText('Unbind the value before changing selection mode.')
  const beforeBound = await readSelectProperties(page, ids.bound)
  await multiple.dispatchEvent('click')
  await expect.poll(() => readSelectProperties(page, ids.bound)).toEqual(beforeBound)
  expect(
    await page.evaluate(
      (id) => window.openPencil?.getStore?.().graph.getNode(id)?.bindings,
      ids.bound
    )
  ).toEqual({ value: { kind: 'ref', ref: 'selected_topics' } })
  canvas.assertNoErrors()
})
