import { expect, test } from '@playwright/test'

import {
  changeLocalFiles,
  chooseLocalFiles,
  dragLocalFile,
  withLocalUpload
} from '#tests/helpers/compiler/components/upload/browser'

for (const target of ['react', 'vue'] as const) {
  test(`${target} a non-boolean disabled expression keeps local selection unavailable`, async ({
    page
  }) => {
    await withLocalUpload(page, target, 'non-boolean-disabled', async () => {
      await expect(
        page.getByRole('button', { name: 'Choose local files', exact: true })
      ).toBeDisabled()
      await expect(page.locator('input[type="file"]')).toBeDisabled()
      await changeLocalFiles(page, ['late.txt'])
      await expect(page.getByRole('listitem')).toHaveCount(0)
      expect((await dragLocalFile(page, 'drop')).prevented).toBe(true)
      await expect(page.getByRole('listitem')).toHaveCount(0)
    })
  })

  test(`${target} local single selection survives rejection and cancellation`, async ({ page }) => {
    await withLocalUpload(page, target, 'single', async () => {
      await chooseLocalFiles(page, ['keep.txt'])
      await expect(page.getByRole('listitem')).toContainText('keep.txt')
      await chooseLocalFiles(page, ['wrong.png'])
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(page.getByRole('listitem')).toContainText('keep.txt')
      await chooseLocalFiles(page, [])
      await expect(page.getByRole('listitem')).toContainText('keep.txt')
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Choose local files', exact: true })
      ).toHaveAccessibleDescription(/wrong.png/)
      await chooseLocalFiles(page, ['replacement.txt'])
      await expect(page.getByRole('listitem')).toContainText('replacement.txt')
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(page.locator('input[type="file"]')).toHaveValue('')
      await page.getByRole('button', { name: /^Remove replacement.txt/ }).click()
      await expect(
        page.getByRole('button', { name: 'Choose local files', exact: true })
      ).toBeFocused()
      await chooseLocalFiles(page, ['replacement.txt'])
      await expect(page.getByRole('listitem')).toContainText('replacement.txt')
    })
  })

  test(`${target} local multiple selection deduplicates before its total limit`, async ({
    page
  }) => {
    await withLocalUpload(page, target, 'multiple', async () => {
      await changeLocalFiles(page, ['one.txt'])
      await changeLocalFiles(page, ['one.txt', 'two.txt'])
      await expect(page.getByRole('listitem')).toHaveCount(2)
      await expect(page.getByRole('alert')).toContainText('already selected')
      await changeLocalFiles(page, ['three.txt'])
      await expect(page.getByRole('listitem')).toHaveCount(3)
      await changeLocalFiles(page, ['four.txt'])
      await expect(page.getByRole('alert')).toContainText('up to 3 files')
      await expect(page.getByRole('listitem')).toHaveCount(3)
      await page.getByRole('button', { name: /^Remove two.txt/ }).click()
      await expect(page.getByRole('button', { name: /^Remove three.txt/ })).toBeFocused()
      await page.getByRole('button', { name: /^Remove three.txt/ }).click()
      await expect(page.getByRole('button', { name: /^Remove one.txt/ })).toBeFocused()
      await page.getByRole('button', { name: 'Clear local selection', exact: true }).click()
      await expect(page.getByRole('listitem')).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: 'Choose local files', exact: true })
      ).toBeFocused()
    })
  })

  test(`${target} hidden local list can be cleared and selected again`, async ({ page }) => {
    await withLocalUpload(page, target, 'hidden', async () => {
      await chooseLocalFiles(page, ['one.txt', 'two.txt'])
      await expect(page.getByRole('listitem')).toHaveCount(0)
      await expect(page.getByRole('status')).toContainText('2')
      await page.getByRole('button', { name: 'Clear local selection', exact: true }).click()
      await expect(page.getByRole('status')).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: 'Choose local files', exact: true })
      ).toBeFocused()
      await chooseLocalFiles(page, ['one.txt'])
      await expect(page.getByRole('status')).toContainText('1')
      await expect(page.getByRole('alert')).toHaveCount(0)
    })
  })

  test(`${target} disabling blocks pending picker and selection mutations until reenabled`, async ({
    page
  }) => {
    await withLocalUpload(page, target, 'disabled', async () => {
      const trigger = page.getByRole('button', { name: 'Choose local files', exact: true })
      await chooseLocalFiles(page, ['keep.txt'])
      const chooserPromise = page.waitForEvent('filechooser')
      await trigger.click()
      const chooser = await chooserPromise
      await page.getByRole('button', { name: 'Disable selection', exact: true }).click()
      await expect(trigger).toBeDisabled()
      await expect(page.locator('input[type="file"]')).toBeDisabled()
      await expect(page.getByRole('button', { name: /^Remove keep.txt/ })).toBeDisabled()
      await expect(
        page.getByRole('button', { name: 'Clear local selection', exact: true })
      ).toBeDisabled()
      await chooser.setFiles([
        { name: 'late.txt', mimeType: 'text/plain', buffer: Buffer.from('123') }
      ])
      await expect(page.getByRole('listitem')).toHaveCount(1)
      await expect(page.getByRole('listitem')).toContainText('keep.txt')
      expect(await dragLocalFile(page, 'dragover')).toEqual({ prevented: true, dropEffect: 'none' })
      expect((await dragLocalFile(page, 'drop')).prevented).toBe(true)
      await expect(page.getByRole('listitem')).toHaveCount(1)
      await page.getByRole('button', { name: 'Enable selection', exact: true }).click()
      await expect(trigger).toBeEnabled()
      await chooseLocalFiles(page, ['next.txt'])
      await expect(page.getByRole('listitem')).toHaveCount(2)
      await dragLocalFile(page, 'dragenter')
      await expect(page.locator('[data-openpencil-upload-root]')).toHaveAttribute(
        'data-dragging',
        'true'
      )
      await page.getByRole('button', { name: 'Disable selection', exact: true }).click()
      await expect(page.locator('[data-openpencil-upload-root]')).toHaveAttribute(
        'data-dragging',
        'false'
      )
      await page.getByRole('button', { name: 'Enable selection', exact: true }).click()
      await page.getByRole('button', { name: 'Clear local selection', exact: true }).click()
      await expect(page.getByRole('listitem')).toHaveCount(0)
    })
  })
}
