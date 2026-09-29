import { expect, test } from '@playwright/test'

import { withBusinessBrowser } from '#tests/helpers/compiler/business/helpers'

test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, actionTimeout: 10_000 })

for (const kind of ['customer-crm', 'personal-blog'] as const) {
  for (const target of ['react', 'vue'] as const) {
    test(`${target} ${kind} keeps the desktop welcome action connected to its auth boundary`, async ({
      page
    }, info) => {
      test.setTimeout(90_000)
      const externalRequests: string[] = []
      page.on('request', (request) => {
        if (new URL(request.url()).hostname === 'identity.example.com')
          externalRequests.push(request.url())
      })
      await page.route('https://identity.example.com/**', (route) => route.abort())
      await withBusinessBrowser(
        page,
        kind,
        target,
        async ({ api, open }) => {
          await open('login')
          const loginURL = page.url()
          await expect(page.getByText('欢迎回来', { exact: true })).toBeVisible()
          await expect(
            page.getByText('账号与登录权限由身份服务管理。', { exact: true })
          ).toBeVisible()
          const welcome =
            kind === 'customer-crm'
              ? '认真维护，\n每一份客户关系。'
              : '把值得记录的事，\n慢慢写下来。'
          for (const title of [welcome, '登录，\n继续你的工作。']) {
            let previousBottom: number | undefined
            for (const line of title.split('\n')) {
              const heading = page.getByText(line, { exact: true })
              await expect(heading).toBeVisible()
              const headingBox = await heading.boundingBox()
              if (!headingBox) throw new Error('Every authored heading line must remain visible')
              if (previousBottom !== undefined)
                expect(headingBox.y).toBeGreaterThanOrEqual(previousBottom)
              previousBottom = headingBox.y + headingBox.height
            }
          }
          // The fixture remains signed in, so the header exposes sign-out. This is the
          // welcome content action, whose real compiler binding calls an observed test auth stub.
          const signIn = page.getByRole('button', { name: '登录', exact: true })
          await expect(signIn).toHaveCount(1)
          await expect(signIn).toBeEnabled()
          const box = await signIn.boundingBox()
          if (!box) throw new Error('The welcome sign-in action must remain visible')
          expect(box.y).toBeGreaterThan(232)
          expect(box.y + box.height).toBeLessThanOrEqual(1000)
          await page.evaluate(() => {
            globalThis.addEventListener('business-test-sign-in', (event) => {
              document.documentElement.dataset.observedSignIn = String(
                (event as CustomEvent<unknown>).detail
              )
            })
          })
          await page.screenshot({ path: info.outputPath(`${kind}-${target}-login-zh.png`) })
          await signIn.click()
          await expect(page.locator('html')).toHaveAttribute(
            'data-observed-sign-in',
            '/account-setup'
          )
          await expect(page).toHaveURL(loginURL)
          expect(externalRequests).toEqual([])
          expect(api.calls).toHaveLength(0)
        },
        { locale: 'zh-cn', observeSignIn: true }
      )
    })
  }
}
