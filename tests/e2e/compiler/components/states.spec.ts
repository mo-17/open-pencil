import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  stateModuleSelector,
  withComponentStates
} from '#tests/helpers/compiler/components/states/browser'
import { STATE_FAMILIES } from '#tests/helpers/compiler/components/states/types'

test.setTimeout(120_000)

for (const locale of ['en', 'zh-CN'] as const)
  test(`react ${locale} rich-text preserves configured font size and line height`, async ({
    page
  }, info) => {
    await withComponentStates(page, 'react', 'rich-text', locale, async () => {
      const hosts = page.locator('[data-openpencil-rich-text]')
      await expect(hosts).toHaveCount(2)
      await expect(hosts.first()).toHaveCSS('font-size', '16px')
      await expect(hosts.nth(1)).toHaveCSS('font-size', '32px')
      await expect(hosts.first()).toHaveCSS('line-height', '24px')
      await expect(hosts.nth(1)).toHaveCSS('line-height', '48px')
      for (const host of await hosts.all()) {
        const content = host.locator('p')
        await expect(content).toHaveText(
          locale === 'zh-CN'
            ? '中文字号与字体回退 Font size fallback'
            : 'Readable font size and fallback'
        )
        await expect(content).toBeVisible()
        const contentBounds = await content.evaluate((paragraph) => {
          const range = document.createRange()
          range.selectNodeContents(paragraph)
          const bounds = range.getBoundingClientRect()
          return { y: bounds.y, height: bounds.height }
        })
        const hostBounds = await host.boundingBox()
        expect(hostBounds).not.toBeNull()
        if (!hostBounds) throw new Error('RichText content bounds unavailable')
        expect(contentBounds.y + contentBounds.height).toBeLessThanOrEqual(
          hostBounds.y + hostBounds.height + 1
        )
      }
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 1100 })
        const image = await page.screenshot({ fullPage: true, animations: 'disabled' })
        await info.attach(`rich-text-react-${locale}-${width}`, {
          body: image,
          contentType: 'image/png'
        })
        const directory = process.env.OPENPENCIL_COMPONENT_STATE_GALLERY_DIR
        if (directory) {
          mkdirSync(directory, { recursive: true })
          await page.screenshot({
            path: join(directory, `rich-text-react-${locale}-${width}.png`),
            fullPage: true,
            animations: 'disabled'
          })
        }
      }
    })
  })

for (const target of ['react', 'vue'] as const)
  for (const locale of ['en', 'zh-CN'] as const)
    for (const family of STATE_FAMILIES)
      test(`${target} ${locale} ${family} preserves disabled and readonly appearances in authored layout`, async ({
        page
      }, info) => {
        await withComponentStates(page, target, family, locale, async () => {
          const hosts = page.locator(stateModuleSelector(family))
          await expect(hosts).toHaveCount(3)
          const disabled = hosts.nth(1)
          const readonly = hosts.nth(2)
          if (family === 'stepper') {
            await expect(disabled).toHaveCSS('opacity', '0.5')
            await expect(readonly).toHaveCSS('opacity', '1')
            for (const host of [disabled, readonly]) {
              await expect(host.getByRole('button')).toHaveCount(4)
              for (const button of await host.getByRole('button').all())
                await expect(button).toBeDisabled()
            }
            await expect(hosts.first().getByRole('button').nth(2)).toBeDisabled()
            await hosts.first().getByRole('button').first().focus()
            await expect(hosts.first().getByRole('button').first()).toBeFocused()
            await expect(hosts.first().getByRole('button').first()).toHaveCSS(
              'outline-style',
              'solid'
            )
          }
          if (family === 'slider' || family === 'range' || family === 'date-range') {
            const inputs = disabled.locator('input:not([type=hidden])')
            await expect(inputs.first()).toBeDisabled()
            await expect(readonly.locator('input:not([type=hidden])').first()).toBeEnabled()
          }
          for (const width of [375, 1440]) {
            await page.setViewportSize({ width, height: 1100 })
            await expect
              .poll(() =>
                page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
              )
              .toBe(true)
            const image = await page.screenshot({ fullPage: true, animations: 'disabled' })
            await info.attach(`${family}-${target}-${locale}-${width}`, {
              body: image,
              contentType: 'image/png'
            })
            const directory = process.env.OPENPENCIL_COMPONENT_STATE_GALLERY_DIR
            if (directory) {
              mkdirSync(directory, { recursive: true })
              await page.screenshot({
                path: join(directory, `${family}-${target}-${locale}-${width}.png`),
                fullPage: true,
                animations: 'disabled'
              })
            }
          }
        })
      })
