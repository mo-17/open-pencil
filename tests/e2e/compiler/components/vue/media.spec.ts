import { expect, test } from '@playwright/test'

import { withVueMedia } from '#tests/helpers/compiler/modules/vue-media/browser'
import { MEDIA_ANIMATION, mediaWav } from '#tests/helpers/compiler/modules/vue-media/fixture'

test.use({ viewport: { width: 375, height: 760 } })

test('Vue audio preview activates local bytes, revokes source consent and retains authored content', async ({
  page
}) => {
  const requests: string[] = []
  await page.route('**/media/*.wav', (route) => {
    requests.push(route.request().url())
    return route.fulfill({ contentType: 'audio/wav', body: Buffer.from(mediaWav(), 'ascii') })
  })
  await withVueMedia(page, async () => {
    const host = page.locator('[data-openpencil-audio-player]')
    await expect(host.getByRole('button', { name: 'Load audio preview' })).toBeVisible()
    await expect(host.locator('audio')).toHaveCount(0)
    expect(requests).toEqual([])
    await expect(host.getByText('<b>Plain artist</b>', { exact: true })).toBeVisible()
    await expect(host.locator('b')).toHaveCount(0)
    await host.getByRole('button', { name: 'Load audio preview' }).click()
    const audio = host.locator('audio')
    await expect(audio).toHaveAttribute('src', '/media/local-tone.wav')
    await expect.poll(() => requests.length).toBe(1)
    expect(
      await audio.evaluate((node) => ({
        volume: (node as HTMLAudioElement).volume,
        rate: (node as HTMLAudioElement).playbackRate,
        muted: (node as HTMLAudioElement).muted
      }))
    ).toEqual({ volume: 0.35, rate: 1.25, muted: true })
    await host.evaluate((node) => node.setAttribute('data-retained', 'yes'))
    await page.getByRole('button', { name: 'Rerender', exact: true }).click()
    await expect(host).toHaveAttribute('data-retained', 'yes')
    await page.getByRole('button', { name: 'Change audio', exact: true }).click()
    await expect(audio).toHaveCount(0)
    await expect(host.getByRole('button', { name: 'Load audio preview' })).toBeVisible()
    expect(requests).toHaveLength(1)
    await host.getByRole('button', { name: 'Load audio preview' }).click()
    await expect(audio).toHaveAttribute('src', '/media/replacement.wav')
    await expect.poll(() => requests.length).toBe(2)
    expect(await audio.evaluate((node) => (node as HTMLAudioElement).volume)).toBe(0.6)
    await expect(host.getByText('Authored audio child', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Toggle media', exact: true }).click()
    await expect(audio).toHaveCount(0)
  })
})

test('Vue production audio initializes authored media without a preview activation button', async ({
  page
}) => {
  await page.route('**/media/*.wav', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: Buffer.from(mediaWav(), 'ascii') })
  )
  await withVueMedia(
    page,
    async () => {
      const host = page.locator('[data-openpencil-audio-player]'),
        audio = host.locator('audio')
      await expect(host.getByRole('button', { name: 'Load audio preview' })).toHaveCount(0)
      await expect(audio).toHaveAttribute('src', '/media/local-tone.wav')
      expect(await audio.evaluate((node) => (node as HTMLAudioElement).volume)).toBe(0.35)
    },
    false
  )
})

test('Vue QR and Code 128 draw locally, update geometry and render caption text inertly', async ({
  page
}, info) => {
  await withVueMedia(page, async () => {
    const codes = page.locator('[data-openpencil-qr-barcode]'),
      qr = codes.first(),
      barcode = codes.last()
    await expect(qr.getByRole('img')).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect(barcode.getByRole('img')).toHaveAccessibleName('Code 128')
    await expect.poll(() => barcode.locator('rect').count()).toBeGreaterThan(0)
    await expect(qr.getByText('<b>Plain caption</b>', { exact: true })).toBeVisible()
    await expect(qr.locator('b')).toHaveCount(0)
    const beforeQr = await qr.getByRole('img').getAttribute('src'),
      beforeBars = await barcode.locator('svg').innerHTML()
    await page.getByRole('button', { name: 'Change codes', exact: true }).click()
    await expect.poll(() => qr.getByRole('img').getAttribute('src')).not.toBe(beforeQr)
    await expect.poll(() => barcode.locator('svg').innerHTML()).not.toBe(beforeBars)
    await expect(page.getByRole('alert')).toHaveCount(0)
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 760 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      )
      await page.screenshot({
        path: info.outputPath('vue-media-' + width + '.png'),
        fullPage: true
      })
    }
  })
})

test('Vue embedded Lottie draws safe SVG, handles invalid data and honors reduced motion', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await withVueMedia(page, async () => {
    const host = page.locator('[data-openpencil-lottie]').first()
    await expect(host).toHaveAttribute('data-lottie-status', 'ready')
    await expect(host.locator('svg')).toHaveCount(1)
    await expect(host.getByText('Authored animation child', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Invalid animation', exact: true }).click()
    await expect(host).toHaveAttribute('data-lottie-status', 'error')
    await expect(host.locator('svg')).toHaveCount(0)
    await expect(host.getByRole('status')).toHaveText('Animation unavailable')
    await page.getByRole('button', { name: 'Repair animation', exact: true }).click()
    await expect(host).toHaveAttribute('data-lottie-status', 'ready')
    await expect(host.locator('svg')).toHaveCount(1)
    await page.getByRole('button', { name: 'Toggle media', exact: true }).click()
    await expect(page.locator('[data-openpencil-lottie]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Toggle media', exact: true }).click()
    await expect(page.locator('[data-openpencil-lottie]').first().locator('svg')).toHaveCount(1)
  })
})

test('Vue remote Lottie requires explicit load, rejects bad MIME, retries and revokes URL authorization', async ({
  page
}) => {
  const urls: string[] = []
  await page.route('https://animations.example.com/**', (route) => {
    urls.push(route.request().url())
    return route.fulfill({
      contentType: urls.length === 1 ? 'text/html' : 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(MEDIA_ANIMATION)
    })
  })
  await withVueMedia(page, async () => {
    const host = page.locator('[data-openpencil-lottie]').last()
    await expect(
      host.getByRole('button', { name: 'Load Lottie animation', exact: true })
    ).toBeVisible()
    expect(urls).toEqual([])
    await host.getByRole('button', { name: 'Load Lottie animation', exact: true }).click()
    await expect(
      host.getByRole('button', { name: 'Retry Lottie animation', exact: true })
    ).toBeVisible()
    expect(urls).toHaveLength(1)
    await host.getByRole('button', { name: 'Retry Lottie animation', exact: true }).click()
    await expect(host).toHaveAttribute('data-lottie-status', 'ready')
    await expect(host.locator('svg')).toHaveCount(1)
    expect(urls).toHaveLength(2)
    await page.getByRole('button', { name: 'Change remote', exact: true }).click()
    await expect(host.locator('svg')).toHaveCount(0)
    await expect(
      host.getByRole('button', { name: 'Load Lottie animation', exact: true })
    ).toBeVisible()
    expect(urls).toHaveLength(2)
    await host.getByRole('button', { name: 'Load Lottie animation', exact: true }).click()
    await expect(host).toHaveAttribute('data-lottie-status', 'ready')
    expect(urls.at(-1)).toContain('/replacement.json')
  })
})
