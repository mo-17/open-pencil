import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test('keeps recovery independent from cancelling an unsaved-document close', async ({
  browser,
  baseURL
}) => {
  test.setTimeout(45_000)
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('RECTANGLE', 120, 120, 240, 140)
    await store.persistRecoveryNow()
    store.updateNode(id, { name: 'Retained recovery rectangle' })
    await store.persistRecoveryNow()
  })

  await expect(page.getByTestId('document-recovery-status')).toHaveAttribute('data-phase', 'ready')
  await expect(page.getByTestId('document-recovery-status').locator('time')).toHaveAttribute(
    'datetime',
    /T/
  )
  await expect(page.getByTestId('document-file-status')).toContainText(
    'No file save in this session'
  )

  await page.keyboard.press('ControlOrMeta+t')
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(2)
  await page.locator('[data-slot="tab-item"]').first().getByTestId('tabbar-close').click()
  await expect(page.getByRole('alertdialog', { name: /Save changes to/ })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(2)
  await expect(page.getByTestId('recent-files-home')).toBeVisible()
  await expect(page.getByTestId('document-save-status')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const request = indexedDB.open('open-pencil-recovery')
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const transaction = database.transaction('meta')
        const countRequest = transaction.objectStore('meta').count()
        return new Promise<number>((resolve, reject) => {
          countRequest.onsuccess = () => resolve(countRequest.result)
          countRequest.onerror = () => reject(countRequest.error)
        })
      })
    )
    .toBe(1)

  page.once('dialog', (dialog) => dialog.accept())
  await page.reload()
  await expect(page.getByRole('alertdialog', { name: 'Recover unsaved work' })).toBeVisible()
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByText('Retained recovery rectangle')).toBeVisible()
  await expect(page.getByTestId('document-recovery-status')).toHaveAttribute('data-phase', 'ready')
  await expect(page.getByTestId('document-recovery-status').locator('time')).toHaveAttribute(
    'datetime',
    /T/
  )
  await expect(page.getByTestId('document-file-status')).toContainText(
    'No file save in this session'
  )

  await context.close()
})
