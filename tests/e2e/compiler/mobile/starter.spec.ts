import { expect, test } from '@playwright/test'

import {
  exerciseReducedViewport,
  expectHorizontalBounds,
  expectNoHorizontalOverflow,
  expectNoOverlap,
  expectTouchTarget,
  mobileBrowserOptions,
  mobileNavigation,
  mobileViewports
} from '#tests/helpers/compiler/mobile/layout'
import { mobileProduct } from '#tests/helpers/compiler/mobile/samples'
import {
  mobileStarterId,
  mobileStarterKinds,
  withMobileStarter
} from '#tests/helpers/compiler/mobile/starter'

test.use(mobileBrowserOptions)

for (const kind of mobileStarterKinds) {
  for (const target of ['react', 'vue'] as const) {
    test(`${target} ${kind} reflows across five viewports and keeps its mobile form reachable`, async ({
      page
    }, info) => {
      test.setTimeout(120_000)
      await withMobileStarter(
        page,
        kind,
        target,
        async ({ base, open, paths }) => {
          const writes: string[] = []
          await page.route('**/*', async (route) => {
            const request = route.request()
            if (!new URL(request.url()).pathname.startsWith(base + '/')) return route.continue()
            if (request.method() !== 'GET') {
              writes.push(request.method())
              return route.fulfill({
                status: 405,
                json: { message: 'Read-only presentation fixture' }
              })
            }
            return route.fulfill({
              json: {
                data: /\/(products|notes)$/u.test(new URL(request.url()).pathname)
                  ? [mobileProduct]
                  : [],
                nextCursor: null
              }
            })
          })
          const operations = kind.endsWith('-commerce')
          const shopControls = operations
            ? { select: '选择', field: '数量', submit: '保存购物车数量' }
            : { select: '选择商品', field: '1–99', submit: '提交订单' }
          const controls =
            kind === 'notes'
              ? { select: 'Edit', field: 'title', submit: 'Save note' }
              : shopControls
          const id = mobileStarterId(kind)
          for (const viewport of mobileViewports) {
            await test.step(viewport.name, async () => {
              await page.setViewportSize({ width: viewport.width, height: viewport.height })
              await open('main')
              const title = page.getByText(mobileProduct.title, { exact: true }).first()
              const select = page
                .getByRole('button', { name: controls.select, exact: true })
                .first()
              await expectHorizontalBounds(page, title)
              await expectTouchTarget(page, select)
              await expectNoOverlap(title, select)
              await expectNoHorizontalOverflow(page)
              if (viewport.width < 1280 && kind !== 'notes')
                await expectTouchTarget(page, mobileNavigation(page))
              else await expect(mobileNavigation(page)).toBeHidden()
              if (viewport.width === 390 || viewport.width === 1440)
                await page.screenshot({
                  path: info.outputPath(`${id}-${target}-${viewport.name}-entry.png`)
                })
              await open('login')
              await expectTouchTarget(
                page,
                page.getByRole('button', {
                  name: kind === 'notes' ? 'Sign in' : '登录',
                  exact: true
                })
              )
              await expectNoHorizontalOverflow(page)
              if (viewport.width === 390 || viewport.width === 1440)
                await page.screenshot({
                  path: info.outputPath(`${id}-${target}-${viewport.name}-login.png`)
                })
            })
          }
          await page.setViewportSize({ width: 390, height: 844 })
          await open('main')
          await page.getByRole('button', { name: controls.select, exact: true }).first().tap()
          const field = page.getByPlaceholder(controls.field, { exact: true })
          const submit = page.getByRole('button', {
            name: controls.submit,
            exact: true
          })
          await exerciseReducedViewport(
            page,
            field,
            kind === 'notes' ? '缩短视口后的笔记草稿' : '2',
            submit
          )
          if (kind !== 'notes') {
            await mobileNavigation(page).selectOption({
              label: operations ? '我的采购单' : '我的订单'
            })
            await expect
              .poll(() => new URL(page.url()).pathname)
              .toBe(paths[operations ? 'purchases' : 'orders'])
            await expectNoHorizontalOverflow(page)
          }
          expect(writes).toEqual([])
        },
        'zh-CN'
      )
    })
  }
}
