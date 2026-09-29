import { expect, test, type Route } from '@playwright/test'

import {
  confirmDialog,
  dismissSuccess,
  expectUnavailable,
  successNotification
} from '#tests/helpers/compiler/feedback/assertions'
import { mobileBrowserOptions } from '#tests/helpers/compiler/mobile/layout'
import { mobileId } from '#tests/helpers/compiler/mobile/samples'
import { withMobileStarter } from '#tests/helpers/compiler/mobile/starter'

test.use({ ...mobileBrowserOptions, reducedMotion: 'reduce' })

for (const target of ['react', 'vue'] as const) {
  test(`${target} notes reports only completed writes and preserves retryable drafts and deletions`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    await withMobileStarter(page, 'notes', target, async ({ base, open }) => {
      let notes = [{ id: mobileId(10), title: 'Original thought', content: 'Keep this note.' }]
      const writes: { method: string; payload?: unknown }[] = []
      let held: Route | undefined
      let holdNext = true
      let rejectDelete = true
      await page.route('**/*', async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        if (!url.pathname.startsWith(base + '/')) return route.continue()
        if (request.method() === 'GET')
          return route.fulfill({ json: { data: notes, nextCursor: null } })
        const payload = request.method() === 'DELETE' ? undefined : request.postDataJSON()
        writes.push({ method: request.method(), payload })
        if (holdNext) {
          holdNext = false
          held = route
          return
        }
        if (request.method() === 'POST') {
          const note = { id: mobileId(11), ...payload }
          notes.push(note)
          return route.fulfill({ json: note })
        }
        const id = url.pathname.split('/').at(-1)
        if (request.method() === 'DELETE') {
          if (rejectDelete) {
            rejectDelete = false
            return route.fulfill({ status: 503, json: { message: 'Temporary failure' } })
          }
          notes = notes.filter((note) => note.id !== id)
          return route.fulfill({ json: { deleted: true } })
        }
        const note = notes.find((entry) => entry.id === id)
        if (!note) return route.fulfill({ status: 404 })
        Object.assign(note, payload)
        return route.fulfill({ json: note })
      })
      await open('main')
      const title = page.getByPlaceholder('title', { exact: true })
      const content = page.getByPlaceholder('content', { exact: true })
      const save = page.getByRole('button', { name: 'Save note', exact: true })
      await title.fill('A retryable thought')
      await content.fill('Do not clear this draft before the server confirms it.')
      await page.clock.fastForward(350)
      await save.tap()
      await expect.poll(() => !!held).toBe(true)
      await expectUnavailable(save)
      await expect(successNotification(page)).toHaveCount(0)
      expect(writes).toHaveLength(1)
      if (!held) throw new Error('Missing held notes write')
      await held.fulfill({ status: 503, json: { message: 'Temporary failure' } })
      await expect(save).toBeEnabled()
      await expect(title).toHaveValue('A retryable thought')
      await expect(content).toHaveValue('Do not clear this draft before the server confirms it.')
      await expect(page.getByText(/Backend .*failed/u)).toBeVisible()
      await expect(successNotification(page)).toHaveCount(0)

      await page.clock.fastForward(350)
      await save.tap()
      await expect.poll(() => writes.length).toBe(2)
      expect(writes[1]).toEqual(writes[0])
      await dismissSuccess(page, /saved|created/iu)
      await expect(title).toHaveValue('')
      await expect(page.getByText('A retryable thought', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Edit', exact: true }).first().tap()
      await title.fill('An updated thought')
      await page.clock.fastForward(350)
      await save.tap()
      await expect.poll(() => writes.length).toBe(3)
      await dismissSuccess(page, /saved|updated/iu)
      await expect(page.getByText('An updated thought', { exact: true })).toBeVisible()

      const remove = page.getByRole('button', { name: 'Delete', exact: true }).last()
      await remove.tap()
      await page.getByRole('button', { name: /^(Cancel|Keep note)$/u }).tap()
      expect(writes).toHaveLength(3)
      await expect(successNotification(page)).toHaveCount(0)
      await expect(page.getByText('A retryable thought', { exact: true })).toBeVisible()
      await page.clock.fastForward(350)
      await remove.tap()
      await confirmDialog(page)
      await expect.poll(() => writes.length).toBe(4)
      await expect(page.getByText(/Backend .*failed/u)).toBeVisible()
      await expect(page.getByText('A retryable thought', { exact: true })).toBeVisible()
      await expect(successNotification(page)).toHaveCount(0)
      await page.clock.fastForward(350)
      await remove.tap()
      await confirmDialog(page)
      await expect.poll(() => writes.length).toBe(5)
      await expect(successNotification(page)).toContainText(/deleted/iu)
      await expect(page.getByText('A retryable thought', { exact: true })).toHaveCount(0)
      await page.clock.runFor(200)
      await page.screenshot({
        path: info.outputPath(`notes-${target}-success.png`),
        animations: 'disabled'
      })
      await dismissSuccess(page, /deleted/iu)
      await save.scrollIntoViewIfNeeded()
      await expect(save).toBeInViewport()
      await expect(save).toBeEnabled()
    })
  })
}
