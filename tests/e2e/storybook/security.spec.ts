import { expect, test, type Page } from '@playwright/test'

const STORY =
  '/iframe.html?id=design-system-inputs-input--default&viewMode=story&globals=theme:light'

/** Exercise the live transport boundary with synthetic, explicitly labelled event origins. */
async function sendThemeMessage(page: Page, origin: string, serialized: boolean) {
  await page.evaluate(
    ({ origin, serialized }) => {
      const data = {
        key: 'storybook-channel',
        event: { type: 'updateGlobals', args: [{ globals: { theme: 'dark' } }], from: 'manager' }
      }
      window.dispatchEvent(
        new MessageEvent('message', {
          origin,
          source: window,
          data: serialized ? JSON.stringify(data) : data
        })
      )
    },
    { origin, serialized }
  )
}

test('development responses block foreign iframe embedding in the browser', async ({
  page,
  request,
  context
}) => {
  const response = await request.get(STORY)
  expect(response.ok()).toBe(true)
  const policy = response.headers()['content-security-policy'] ?? ''
  expect(policy).toContain("frame-ancestors 'self'")
  expect(policy).not.toMatch(/frame-ancestors[^;]*(?:https?:|\s)\*(?:\s|;|$)/)
  const diagnostics: string[] = []
  page.on('console', (message) => diagnostics.push(message.text()))
  page.on('requestfailed', (request) =>
    diagnostics.push(request.failure()?.errorText ?? 'request failed')
  )
  // Reach Storybook's own boundary rather than stopping at Chromium's earlier network permission.
  await context.grantPermissions(['local-network-access'], {
    origin: 'https://storybook-attacker.invalid'
  })
  await page.route('https://storybook-attacker.invalid/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<iframe src="${response.url()}"></iframe>`
    })
  )
  await page.goto('https://storybook-attacker.invalid/')
  await page.waitForLoadState('networkidle')
  expect(diagnostics.join('\n')).toContain('frame-ancestors')
  expect(page.frames().some((frame) => frame.url() === response.url())).toBe(false)
})

for (const origin of ['https://attacker.invalid', 'https://localhost.attacker.invalid', 'null']) {
  for (const serialized of [false, true]) {
    test(`synthetic ${serialized ? 'serialized' : 'object'} channel message from ${origin} is rejected`, async ({
      page
    }) => {
      await page.goto(STORY)
      await expect(page.getByRole('searchbox', { name: 'Search files' })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      const rejected = page.waitForEvent('console', {
        predicate: (message) =>
          message.text().includes('Ignored Storybook channel message') &&
          message.text().includes(origin)
      })
      await sendThemeMessage(page, origin, serialized)
      await rejected
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
      await sendThemeMessage(page, new URL(page.url()).origin, serialized)
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    })
  }
}
