import { writeFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

import { BUSINESS_TEMPLATE_IDS } from '@/app/lowcode/backend/business/model/types'

import { withBusinessBrowser } from '#tests/helpers/compiler/business/helpers'
import { presentationResources } from '#tests/helpers/compiler/business/presentation/fixtures'
import {
  exerciseReducedViewport,
  expectActionNotClipped,
  expectHorizontalBounds,
  expectNoHorizontalOverflow,
  expectNoOverlap,
  expectTouchTarget,
  inspectActionLayout,
  mobileBrowserOptions,
  mobileNavigation,
  mobileViewports
} from '#tests/helpers/compiler/mobile/layout'
import { mobileDishes } from '#tests/helpers/compiler/mobile/samples'

test.use(mobileBrowserOptions)

for (const kind of BUSINESS_TEMPLATE_IDS) {
  for (const target of ['react', 'vue'] as const) {
    test(`${target} ${kind} reflows across five viewports and retains mobile account editing`, async ({
      page
    }, info) => {
      test.setTimeout(120_000)
      await withBusinessBrowser(
        page,
        kind,
        target,
        async ({ fixture, api, open }) => {
          const food = kind === 'food-ordering'
          const sample = food
            ? {
                entryId: 'food-menu',
                title: mobileDishes[0].title,
                detail: '菜品: ' + mobileDishes[0].title,
                resources: { 'food-menu': mobileDishes }
              }
            : (() => {
                const value = presentationResources(fixture.application, fixture.definition)
                const detail = (value.entry.details ?? value.entry.listing?.columns)?.[0]
                if (!detail) throw new Error('A mobile listing must expose record details')
                return {
                  entryId: value.entry.id,
                  title: `${value.primary.label.zh}: ${value.rows[0][value.primary.field]}`,
                  detail: `${detail.label.zh}: ${value.rows[0][detail.field]}`,
                  resources: value.resources
                }
              })()
          Object.assign(api.resources, sample.resources)
          const selectLabel = food ? '查看详情' : '选择记录'
          for (const viewport of mobileViewports) {
            await test.step(viewport.name, async () => {
              await page.setViewportSize({ width: viewport.width, height: viewport.height })
              await open(sample.entryId)
              const title = page.getByText(sample.title, { exact: true }).first()
              const select = page.getByRole('button', { name: selectLabel, exact: true }).first()
              await expect(title).toBeVisible()
              await expectHorizontalBounds(page, title)
              await expectTouchTarget(page, select)
              await expectNoOverlap(title, select)
              if (food) {
                const price = page.getByText('¥32.00', { exact: true })
                await expectHorizontalBounds(page, price)
                await expectNoOverlap(title, price)
                await expectNoOverlap(price, select)
              }
              await expectNoHorizontalOverflow(page)
              if (viewport.width < 1280) await expectTouchTarget(page, mobileNavigation(page))
              else await expect(mobileNavigation(page)).toBeHidden()
              if (viewport.width === 390 || viewport.width === 1440)
                await page.screenshot({
                  path: info.outputPath(`${kind}-${target}-${viewport.name}-entry.png`)
                })

              await open('login')
              const signIn = page.getByRole('button', { name: '登录', exact: true })
              await expectTouchTarget(page, signIn)
              await expectNoHorizontalOverflow(page)
              if (viewport.width === 390 || viewport.width === 1440)
                await page.screenshot({
                  path: info.outputPath(`${kind}-${target}-${viewport.name}-login.png`)
                })
            })
          }

          await page.setViewportSize({ width: 390, height: 844 })
          await open(sample.entryId)
          const selection = page.getByRole('button', { name: selectLabel, exact: true }).first()
          if (food) {
            await writeFile(
              info.outputPath('food-card-layout.json'),
              JSON.stringify(await inspectActionLayout(selection), null, 2)
            )
            await expectActionNotClipped(selection)
            await expectNoOverlap(
              selection.locator('..'),
              page.getByRole('button', { name: selectLabel, exact: true }).nth(1).locator('..')
            )
          }
          await selection.tap()
          await expect(page.getByText(sample.detail, { exact: true }).last()).toBeVisible()
          await expectNoHorizontalOverflow(page)
          await mobileNavigation(page).selectOption({ label: '账号设置' })
          await expect(page).toHaveURL(/\/account-setup$/u)
          await page.getByRole('button', { name: '登记本人资料', exact: true }).tap()
          const field = page.getByPlaceholder('显示名称', { exact: true })
          await field.fill('手机界面验证')
          await exerciseReducedViewport(
            page,
            field,
            '保留横屏与缩短视口后的草稿',
            page.getByRole('button', { name: '登记本人资料', exact: true }).last()
          )
          expect(api.calls).toHaveLength(0)
        },
        { locale: 'zh-cn' }
      )
    })
  }
}
