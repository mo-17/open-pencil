import { expect, test } from '@playwright/test'

import {
  expectNoHorizontalOverflow,
  mobileBrowserOptions
} from '#tests/helpers/compiler/mobile/layout'
import { mobileProduct } from '#tests/helpers/compiler/mobile/samples'
import { mobileStarterKinds, withMobileStarter } from '#tests/helpers/compiler/mobile/starter'

test.use({ ...mobileBrowserOptions, viewport: { width: 320, height: 640 } })

for (const kind of mobileStarterKinds) {
  for (const target of ['react', 'vue'] as const) {
    test(`${target} ${kind} keeps every generated route usable at 320 pixels`, async ({ page }) => {
      test.setTimeout(120_000)
      await withMobileStarter(
        page,
        kind,
        target,
        async ({ base, open, paths }) => {
          const writes: string[] = []
          await page.route('**/*', async (route) => {
            const request = route.request()
            const path = new URL(request.url()).pathname
            if (!path.startsWith(base + '/')) return route.continue()
            if (request.method() !== 'GET') {
              writes.push(request.method())
              return route.fulfill({ status: 405, json: { message: 'Read-only route fixture' } })
            }
            return route.fulfill({
              json: {
                data: /\/(products|notes)$/u.test(path) ? [mobileProduct] : [],
                nextCursor: null
              }
            })
          })
          const uniqueRoutes = new Map(Object.entries(paths).map(([key, path]) => [path, key]))
          for (const [path, key] of uniqueRoutes) {
            await test.step(path, async () => {
              await open(key)
              await expect(page.locator('body')).not.toBeEmpty()
              await expectNoHorizontalOverflow(page)
              const controls = await page.evaluate(() =>
                [...document.querySelectorAll('button,input,textarea,select')].flatMap(
                  (element) => {
                    const box = element.getBoundingClientRect()
                    if (!box.width || !box.height) return []
                    const style = getComputedStyle(element)
                    if (style.visibility === 'hidden') return []
                    const invalid =
                      box.x < -1 ||
                      box.right > innerWidth + 1 ||
                      box.width < 44 ||
                      box.height < 44 ||
                      Number.parseFloat(style.fontSize) < 16
                    return invalid
                      ? [
                          {
                            tag: element.tagName,
                            text: element.textContent?.slice(0, 80),
                            width: box.width,
                            height: box.height,
                            x: box.x,
                            fontSize: style.fontSize
                          }
                        ]
                      : []
                  }
                )
              )
              expect(controls).toEqual([])
            })
          }
          expect(writes).toEqual([])
        },
        'zh-CN'
      )
    })
  }
}
