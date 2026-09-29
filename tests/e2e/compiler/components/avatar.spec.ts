import { expect, test } from '@playwright/test'

import { withAvatar } from '#tests/helpers/compiler/modules/avatar/browser'

test.use({ viewport: { width: 375, height: 700 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} Avatar shows local media and decode fallback, with compact shape geometry`, async ({
    page
  }, info) => {
    await withAvatar(page, target, async () => {
      const initials = page.getByRole('img', { name: 'Alex Morgan', exact: true })
      await expect(initials.locator('[data-avatar-fallback]')).toHaveText('AM')
      await expect(
        page.getByRole('img', { name: '张小明', exact: true }).locator('[data-avatar-fallback]')
      ).toHaveText('小明')
      const local = page.getByRole('img', { name: '本地图片', exact: true })
      await expect(local.locator('[data-avatar-image]')).toHaveCount(1)
      await expect(local.locator('[data-avatar-fallback]')).toHaveCount(0)
      const decoded = await local.locator('[data-avatar-image]').evaluate(async (element) => {
        const href = element.getAttribute('href')
        if (!href) throw new Error('Missing local image')
        const blob = await (await fetch(href)).blob()
        const bitmap = await createImageBitmap(blob)
        const size = [bitmap.width, bitmap.height]
        bitmap.close()
        return size
      })
      expect(decoded).toEqual([2, 2])
      const broken = page.getByRole('img', { name: '损坏图片', exact: true })
      await expect(broken.locator('[data-avatar-fallback]')).toHaveText('损坏')
      await expect(broken.locator('[data-avatar-image]')).toHaveCount(0)
      for (const [name, size] of [
        ['窄容器', 24],
        ['适应图片', 48]
      ] as const) {
        const host = page.getByRole('img', { name, exact: true })
        const geometry = await host.evaluate((element) => {
          const svg = element.querySelector('svg'),
            rect = element.querySelector('g > rect')
          if (!svg || !(rect instanceof SVGRectElement)) throw new Error('Missing avatar shape')
          const hostBox = element.getBoundingClientRect(),
            box = rect.getBoundingClientRect()
          return {
            hostWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            width: box.width,
            height: box.height,
            left: box.left - hostBox.left,
            top: box.top - hostBox.top,
            bottom: box.bottom - hostBox.top,
            hostHeight: hostBox.height
          }
        })
        expect(geometry.width).toBeCloseTo(size, 1)
        expect(geometry.height).toBeCloseTo(size, 1)
        expect(geometry.left).toBeGreaterThanOrEqual(0)
        expect(geometry.top).toBeGreaterThanOrEqual(0)
        expect(geometry.bottom).toBeLessThanOrEqual(geometry.hostHeight + 0.1)
        expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.hostWidth + 1)
      }
      await expect(
        page.getByRole('img', { name: '适应图片', exact: true }).locator('[data-avatar-image]')
      ).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      )
      await page.screenshot({ path: info.outputPath(`${target}-avatar-375.png`), fullPage: true })
    })
  })
  test(`${target} Avatar recovers on a new local asset and never loads an unregistered URL`, async ({
    page
  }) => {
    const external: string[] = []
    page.on('request', (request) => {
      if (request.url().startsWith('https://example.com')) external.push(request.url())
    })
    await withAvatar(
      page,
      target,
      async () => {
        const avatar = page.getByRole('img', { name: 'Avatar update', exact: true })
        await expect(avatar.locator('[data-avatar-fallback]')).toHaveText('AU')
        await page.getByRole('button', { name: 'Use local image' }).click()
        await expect(avatar.locator('[data-avatar-image]')).toHaveCount(1)
        await expect(avatar.locator('[data-avatar-fallback]')).toHaveCount(0)
        const previousImage = await avatar.locator('[data-avatar-image]').elementHandle()
        if (!previousImage) throw new Error('Missing old avatar image')
        await page.getByRole('button', { name: 'Use alternate image' }).click()
        await expect(avatar.locator('[data-avatar-image]')).toHaveAttribute(
          'href',
          /avatar-alternate/
        )
        // The detached A image must not mark the new B image as failed.
        await previousImage.evaluate((element) => element.dispatchEvent(new Event('error')))
        await expect(avatar.locator('[data-avatar-image]')).toHaveAttribute(
          'href',
          /avatar-alternate/
        )
        await expect(avatar.locator('[data-avatar-fallback]')).toHaveCount(0)
        await page.getByRole('button', { name: 'Use broken image' }).click()
        await expect(avatar.locator('[data-avatar-fallback]')).toHaveText('AU')
        await page.getByRole('button', { name: 'Use local image' }).click()
        await expect(avatar.locator('[data-avatar-image]')).toHaveCount(1)
        await page.getByRole('button', { name: 'Use initials' }).click()
        const changed = page.getByRole('img', { name: '张小明', exact: true })
        await expect(changed.locator('[data-avatar-fallback]')).toHaveText('张小')
        await page.getByRole('button', { name: 'Unknown asset' }).click()
        await expect(changed.locator('[data-avatar-fallback]')).toHaveText('张小')
        await expect(changed.locator('[data-avatar-image]')).toHaveCount(0)
        expect(external).toEqual([])
      },
      true
    )
  })
}
