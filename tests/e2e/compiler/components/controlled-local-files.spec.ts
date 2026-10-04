import { expect, test } from '@playwright/test'

import { withControlledLocalData } from '#tests/helpers/compiler/components/controlled-local-data/browser'

for (const target of ['react', 'vue'] as const) {
  test(`${target} local File API projects outside changes and emits accepted user changes only`, async ({
    page
  }) => {
    await withControlledLocalData(page, target, 'upload', async () => {
      const controlled = page.getByTestId('controlled')
      const input = controlled.locator('input[type="file"]')
      const changes = page.getByTestId('changes')
      const list = page.getByRole('list', { name: 'Files selected locally' })
      await expect(list).toHaveText(/seed.txt/)
      await expect(changes).toHaveText('0')
      await page.getByRole('button', { name: 'External files', exact: true }).click()
      await expect(list).toHaveText(/external.txt/)
      await expect(changes).toHaveText('0')
      await input.setInputFiles({
        name: 'picked.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('abc')
      })
      await expect(list).toHaveText(/picked.txt/)
      await expect(changes).toHaveText('1')
      await expect(page.getByTestId('actual-files')).toHaveText('true')
      await input.setInputFiles({
        name: 'rejected.png',
        mimeType: 'image/png',
        buffer: Buffer.from('abc')
      })
      await expect(changes).toHaveText('1')
      await expect(list).not.toHaveText(/rejected.png/)
      await input.setInputFiles({
        name: 'large.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('123456789')
      })
      await expect(changes).toHaveText('1')
      await page
        .getByRole('button', { name: 'Remove picked.txt from local selection', exact: true })
        .click()
      await expect(changes).toHaveText('2')
      await expect(list).not.toHaveText(/picked.txt/)
      await page.getByRole('button', { name: 'Clear local selection', exact: true }).click()
      await expect(changes).toHaveText('3')
      await expect(list).toHaveCount(0)
      // oxlint-disable-next-line open-pencil/no-direct-storage-access -- Assert this local runtime never persists file selections.
      expect(await page.evaluate(() => localStorage.length)).toBe(0)
      expect(await controlled.locator('input[name]').count()).toBe(0)
      expect(await page.evaluate(() => '__opDocStore' in window)).toBe(false)
    })
  })

  test(`${target} local File API rejects unavailable values and preserves read-only and unowned state`, async ({
    page
  }) => {
    await withControlledLocalData(page, target, 'upload', async () => {
      const controlled = page.getByTestId('controlled')
      const input = controlled.locator('input[type="file"]')
      const changes = page.getByTestId('changes')
      await page.getByRole('button', { name: 'Toggle read only', exact: true }).click()
      await expect(input).toBeDisabled()
      await expect(page.getByRole('list', { name: 'Files selected locally' })).toHaveText(
        /seed.txt/
      )
      await page.getByRole('button', { name: 'External files', exact: true }).click()
      await expect(page.getByRole('list', { name: 'Files selected locally' })).toHaveText(
        /external.txt/
      )
      await expect(changes).toHaveText('0')
      await page.getByRole('button', { name: 'Missing files', exact: true }).click()
      await expect(controlled).toHaveAttribute('data-openpencil-upload-unavailable', 'true')
      await expect(
        page.getByText('Local file selection unavailable.', { exact: true })
      ).toBeVisible()
      await expect(page.getByRole('list', { name: 'Files selected locally' })).toHaveCount(0)
      await page.getByRole('button', { name: 'Invalid metadata', exact: true }).click()
      await expect(controlled).toHaveAttribute('data-openpencil-upload-unavailable', 'true')
      await expect(changes).toHaveText('0')
      await page.getByRole('button', { name: 'External files', exact: true }).click()
      await page.getByRole('button', { name: 'Toggle read only', exact: true }).click()
      await page.getByRole('button', { name: 'Toggle ignored change', exact: true }).click()
      await input.setInputFiles({
        name: 'ignored.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('abc')
      })
      await expect(changes).toHaveText('1')
      await expect(page.getByRole('list', { name: 'Files selected locally' })).not.toHaveText(
        /ignored.txt/
      )
      const local = page.getByTestId('uncontrolled')
      await local
        .locator('input[type="file"]')
        .setInputFiles({ name: 'local.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') })
      await expect(
        page.getByRole('button', { name: 'Remove local.txt from local selection' })
      ).toBeVisible()
      await page.getByRole('button', { name: 'External files', exact: true }).click()
      await expect(
        page.getByRole('button', { name: 'Remove local.txt from local selection' })
      ).toBeVisible()
      await page
        .getByTestId('local-form')
        .evaluate((element) => (element as HTMLFormElement).reset())
      await expect(
        page.getByRole('button', { name: 'Remove local.txt from local selection' })
      ).toBeVisible()
      await expect(changes).toHaveText('1')
    })
  })
}
