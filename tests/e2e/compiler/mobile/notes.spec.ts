import { expect, test } from '@playwright/test'

import {
  exerciseReducedViewport,
  expectNoHorizontalOverflow,
  mobileBrowserOptions
} from '#tests/helpers/compiler/mobile/layout'
import { mobileId } from '#tests/helpers/compiler/mobile/samples'
import { withMobileStarter } from '#tests/helpers/compiler/mobile/starter'

test.use(mobileBrowserOptions)

for (const target of ['react', 'vue'] as const) {
  test(`${target} mobile notes creates edits and deletes while keeping the focused draft`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    await withMobileStarter(page, 'notes', target, async ({ base, open }) => {
      let notes = [{ id: mobileId(10), title: 'Original thought', content: 'A quiet morning.' }]
      const writes: { method: string; payload?: unknown }[] = []
      await page.route('**/*', async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        if (!url.pathname.startsWith(base + '/')) return route.continue()
        if (request.method() === 'GET')
          return route.fulfill({ json: { data: notes, nextCursor: null } })
        const payload = request.method() === 'DELETE' ? undefined : request.postDataJSON()
        writes.push({ method: request.method(), payload })
        if (request.method() === 'POST') {
          const note = { id: mobileId(11), ...payload }
          notes.push(note)
          return route.fulfill({ json: note })
        }
        const id = url.pathname.split('/').at(-1)
        if (request.method() === 'DELETE') {
          notes = notes.filter((note) => note.id !== id)
          return route.fulfill({ json: { deleted: true } })
        }
        const note = notes.find((entry) => entry.id === id)
        if (!note) return route.fulfill({ status: 404 })
        Object.assign(note, payload)
        return route.fulfill({ json: note })
      })
      await open('main')
      await page.getByPlaceholder('title', { exact: true }).fill('A mobile thought')
      const content = 'Preserve this thought while the visible viewport becomes shorter.'
      await exerciseReducedViewport(
        page,
        page.getByPlaceholder('content', { exact: true }),
        content,
        page.getByRole('button', { name: 'Save note', exact: true })
      )
      await page.clock.fastForward(350)
      await page.getByRole('button', { name: 'Save note', exact: true }).tap()
      await expect.poll(() => writes.length).toBe(1)
      expect(writes[0]).toEqual({
        method: 'POST',
        payload: { title: 'A mobile thought', content }
      })
      await page.getByRole('button', { name: 'Edit', exact: true }).first().tap()
      await expect(page.getByPlaceholder('content', { exact: true })).toHaveValue(
        'A quiet morning.'
      )
      await page.getByPlaceholder('title', { exact: true }).fill('An updated mobile thought')
      await page.clock.fastForward(350)
      await page.getByRole('button', { name: 'Save note', exact: true }).tap()
      await expect.poll(() => writes.length).toBe(2)
      expect(writes[1].payload).toEqual({
        title: 'An updated mobile thought',
        content: 'A quiet morning.'
      })
      await expect(page.getByText('An updated mobile thought', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Delete', exact: true }).last().tap()
      await page.getByRole('button', { name: 'Delete note', exact: true }).tap()
      await expect.poll(() => writes.length).toBe(3)
      expect(writes[2]).toEqual({ method: 'DELETE' })
      await expect(page.getByText('A mobile thought', { exact: true })).toHaveCount(0)
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: info.outputPath(`personal-notes-${target}-mobile-flow.png`) })
    })
  })
}
