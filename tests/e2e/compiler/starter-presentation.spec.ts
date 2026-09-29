import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'

import type { StarterPresentationKind } from '#tests/helpers/compiler/starter/fixtures'

async function withStarter(
  page: Page,
  kind: StarterPresentationKind,
  target: 'react' | 'vue',
  run: (fixture: { base: string; open: (key: string) => Promise<void> }) => Promise<void>,
  locale = 'en'
) {
  const fixture = JSON.parse(
    execFileSync(
      'bun',
      [
        '-e',
        `import {starterPresentationFixture} from './tests/helpers/compiler/starter/fixtures'; process.stdout.write(JSON.stringify(await starterPresentationFixture(${JSON.stringify(kind)},${JSON.stringify(target)},${JSON.stringify(locale)})))`
      ],
      { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
  ) as {
    files: [string, string][]
    paths: Record<string, string>
    apiBasePath: string
  }
  const { createPreviewServer } = await import(
    pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
  )
  const server: PreviewServer = await createPreviewServer({
    target,
    initialFiles: new Map(fixture.files)
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setViewportSize({ width: 1280, height: 1000 })
    await page.clock.install()
    await run({
      base: fixture.apiBasePath,
      open: async (key) => {
        const url = new URL(fixture.paths[key], server.url).href
        await page.route(url, async (route) =>
          route.fulfill({ response: await route.fetch({ url: server.url }) })
        )
        await page.goto(url)
      }
    })
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await server.close()
  }
}

for (const target of ['react', 'vue'] as const) {
  for (const kind of [
    'notes',
    'shop',
    'single-merchant-shop',
    'multi-merchant-marketplace',
    'single-merchant-commerce',
    'multi-merchant-commerce'
  ] as const) {
    test(`${target} ${kind} editable starter presentation renders its entry and login`, async ({
      page
    }, info) => {
      test.setTimeout(90_000)
      const aliases: Partial<Record<StarterPresentationKind, string>> = {
        notes: 'personal-notes',
        shop: 'single-sku-shop'
      }
      const id = aliases[kind] ?? kind
      const directory = process.env.STARTER_PRESENTATION_ARTIFACT_DIR ?? info.outputDir
      await mkdir(directory, { recursive: true })
      await withStarter(
        page,
        kind,
        target,
        async ({ base, open }) => {
          const title = kind === 'notes' ? 'A little room for ideas' : '日常手作陶瓷杯'
          await page.route('**/*', async (route) => {
            const request = route.request()
            const url = new URL(request.url())
            if (!url.pathname.startsWith(base + '/')) return route.continue()
            expect(request.method()).toBe('GET')
            return route.fulfill({
              json: {
                data: /\/(products|notes)$/u.test(url.pathname)
                  ? [
                      {
                        id: '00000000-0000-4000-8000-000000000020',
                        store_id: '00000000-0000-4000-8000-000000000030',
                        title,
                        content:
                          'Capture a thought. Give it room to grow.\nCome back whenever you need.',
                        price: 2400,
                        stock: 12,
                        active: true
                      }
                    ]
                  : [],
                nextCursor: null
              }
            })
          })
          await open('main')
          await expect(page.getByText(title, { exact: true }).first()).toBeVisible()
          if (kind.endsWith('-commerce')) {
            const filter = await page
              .getByRole('button', { name: '查看全部商品', exact: true })
              .boundingBox()
            const heading = await page.getByText('电商商城', { exact: true }).last().boundingBox()
            if (!filter || !heading) throw new Error('Expected the catalog filter and heading')
            expect(heading.y).toBeGreaterThanOrEqual(filter.y + filter.height + 8)
          }
          await page.screenshot({ path: join(directory, `${id}-${target}-entry-zh.png`) })
          await open('login')
          await expect(page.getByRole('button', { name: /^(Sign in|登录)$/u })).toBeVisible()
          await page.screenshot({ path: join(directory, `${id}-${target}-login-zh.png`) })
        },
        'zh-CN'
      )
    })
  }

  test(`${target} notes workspace keeps create, edit, delete and login usable`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    await withStarter(page, 'notes', target, async ({ base, open }) => {
      let notes = [
        {
          id: '00000000-0000-4000-8000-000000000010',
          title: 'A little room for ideas',
          content: 'A quiet morning, a good book, and a thought worth keeping.\n'.repeat(10)
        }
      ]
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
          const note = { id: '00000000-0000-4000-8000-000000000011', ...payload }
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
      await expect(page.getByText(notes[0].title, { exact: true })).toBeVisible()
      await page.getByPlaceholder('title', { exact: true }).fill('A new thought')
      await page
        .getByPlaceholder('content', { exact: true })
        .fill('Keep this editable and easy to find.')
      await page.getByRole('button', { name: 'Save note', exact: true }).click()
      await expect.poll(() => writes.length).toBe(1)
      expect(writes[0]).toEqual({
        method: 'POST',
        payload: { title: 'A new thought', content: 'Keep this editable and easy to find.' }
      })
      await expect(page.getByText('A new thought', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
      await expect(page.getByPlaceholder('content', { exact: true })).toHaveValue(notes[0].content)
      await page.getByPlaceholder('title', { exact: true }).fill('An updated thought')
      await page.clock.fastForward(350)
      await page.getByRole('button', { name: 'Save note', exact: true }).click()
      await expect.poll(() => writes.length).toBe(2)
      await expect(page.getByText('An updated thought', { exact: true })).toBeVisible()
      await page.screenshot({ path: info.outputPath('notes-workspace.png') })
      await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
      await page.getByRole('button', { name: 'Delete note', exact: true }).click()
      await expect.poll(() => writes.length).toBe(3)
      await expect(page.getByText('A new thought', { exact: true })).toHaveCount(0)
      await open('login')
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
      await page.screenshot({ path: info.outputPath('notes-login.png') })
    })
  })

  test(`${target} shop redesign preserves checkout confirmation and saved-request recovery`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    await withStarter(page, 'shop', target, async ({ base, open }) => {
      const product = {
        id: '00000000-0000-4000-8000-000000000020',
        title: 'Everyday ceramic cup',
        price: 2400,
        stock: 12,
        active: true
      }
      const calls: { payload: unknown; key?: string }[] = []
      await page.route('**/*', async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        if (!url.pathname.startsWith(base + '/')) return route.continue()
        if (request.method() === 'GET')
          return route.fulfill({
            json: { data: url.pathname.endsWith('/products') ? [product] : [], nextCursor: null }
          })
        calls.push({ payload: request.postDataJSON(), key: request.headers()['idempotency-key'] })
        return route.fulfill({
          json: {
            id: '00000000-0000-4000-8000-000000000021',
            sku_id: product.id,
            product_title: product.title,
            quantity: 2,
            unit_price: 2400,
            total: 4800,
            status: 'pending',
            created_at: '2026-09-16T00:00:00.000Z'
          }
        })
      })
      await open('main')
      await expect(page.getByText(product.title, { exact: true })).toBeVisible()
      await page.screenshot({ path: info.outputPath('shop-catalog.png') })
      await page.getByRole('button', { name: 'Choose product', exact: true }).click()
      await page.getByPlaceholder('1–99', { exact: true }).fill('2')
      await page.clock.fastForward(350)
      await page.getByRole('button', { name: 'Place order', exact: true }).click()
      await page.getByRole('button', { name: 'Confirm order', exact: true }).click()
      await expect.poll(() => calls.length).toBe(1)
      expect(calls[0].payload).toEqual({ skuId: product.id, quantity: 2 })
      expect(calls[0].key).toMatch(/^[A-Za-z0-9._:-]{16,128}$/u)
      await expect(page.getByRole('button', { name: 'Start new order', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Start new order', exact: true }).click()
      await page.getByRole('button', { name: /^(OK|Confirm)$/u }).click()
      await expect(page.getByRole('button', { name: 'Start new order', exact: true })).toHaveCount(
        0
      )
      await open('login')
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
      await page.screenshot({ path: info.outputPath('shop-login.png') })
    })
  })
}
