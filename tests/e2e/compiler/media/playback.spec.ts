import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { installBusinessTransport } from '#tests/engine/app/lowcode/backend/business/browser/transport/helpers'
import { serveTourExport } from '#tests/helpers/compiler/vr-tour'

const MEDIA_ORIGIN = 'https://media.example.com'
const VIDEO_ID = '00000000-0000-4000-8000-000000000101'
const CHANNEL_ID = '00000000-0000-4000-8000-000000000102'
const FAVORITE_ID = '00000000-0000-4000-8000-000000000103'
const root = process.env.OPENPENCIL_MEDIA_EXPORT_ROOT

interface ExportFixture {
  application: BackendApplicationSpecV1
  paths: Record<string, string>
}

for (const target of ['react', 'vue'] as const) {
  test(`${target} exported video template decodes MP4 and HLS, clears selection and filters boolean favorites`, async ({
    page
  }, info) => {
    test.skip(!root, 'Build the opt-in exported media fixtures first.')
    if (!root) return
    const fixture: ExportFixture = JSON.parse(readFileSync(join(root, target + '.json'), 'utf8'))
    const server = await serveTourExport(join(root, target))
    const api = await installBusinessTransport(page, fixture.application)
    const requests: string[] = []
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.clock.install()
    const row = {
      id: VIDEO_ID,
      title: 'Synthetic video',
      category: 'Demo',
      description: 'A local codec fixture',
      playback_url: MEDIA_ORIGIN + '/sample.mp4',
      poster_url: '',
      status: 'published',
      version: 0,
      created_at: '2026-09-15T00:00:00.000Z'
    }
    api.resources['media-videos'] = [row]
    api.resources['media-channels'] = [
      {
        ...row,
        id: CHANNEL_ID,
        title: 'Synthetic HLS channel',
        playback_url: MEDIA_ORIGIN + '/sample.m3u8',
        status: 'live',
        scheduled_at: '2026-09-15T00:00:00.000Z'
      }
    ]
    api.resources['media-favorites'] = [
      {
        id: FAVORITE_ID,
        video_id: VIDEO_ID,
        video_title: 'Saved synthetic video',
        active: true,
        version: 0,
        created_at: row.created_at
      },
      {
        id: '00000000-0000-4000-8000-000000000104',
        video_id: CHANNEL_ID,
        video_title: 'Removed synthetic video',
        active: false,
        version: 1,
        created_at: row.created_at
      }
    ]
    await page.route(MEDIA_ORIGIN + '/**', async (route) => {
      const name = new URL(route.request().url()).pathname.slice(1)
      if (
        !['sample.mp4', 'sample.m3u8', 'init.mp4', 'segment-0.m4s', 'segment-1.m4s'].includes(name)
      )
        throw new Error('Unexpected media fixture request')
      requests.push(name)
      await route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*' },
        contentType: name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
        body: readFileSync(join('tests/fixtures/media', name))
      })
    })
    const navigate = async (name: string) => {
      await page.getByRole('button', { name, exact: true }).first().click()
    }
    try {
      const entry = new URL(fixture.paths['media-videos'], server.url).href
      // A static host serves the built entry for client-side history routes.
      await page.route(entry, async (route) =>
        route.fulfill({ response: await route.fetch({ url: server.url }) })
      )
      await page.goto(entry)
      await expect(page.getByText('Title: Synthetic video', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Select record', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Load video', exact: true })).toBeVisible()
      expect(requests).toEqual([])
      await page.getByRole('button', { name: 'Load video', exact: true }).click()
      const video = page.locator('[data-openpencil-video] video')
      await expect
        .poll(() =>
          video.evaluate((node) => (node instanceof HTMLVideoElement ? node.videoWidth : 0))
        )
        .toBe(160)
      await video.evaluate(async (node) => {
        if (node instanceof HTMLVideoElement) {
          node.muted = true
          await node.play()
        }
      })
      await expect
        .poll(() =>
          video.evaluate((node) => (node instanceof HTMLVideoElement ? node.currentTime : 0))
        )
        .toBeGreaterThan(0)
      const mp4 = await video.elementHandle()
      if (!mp4) throw new Error('Missing playing MP4 element')
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
      await expect(video).toHaveCount(0)
      expect(
        await mp4.evaluate(
          (node) => node instanceof HTMLVideoElement && node.paused && !node.hasAttribute('src')
        )
      ).toBe(true)
      await mp4.dispose()

      await navigate('Live channels')
      await page.getByRole('button', { name: 'Select record', exact: true }).click()
      await page.getByRole('button', { name: 'Load video', exact: true }).click()
      await expect
        .poll(() =>
          video.evaluate((node) => (node instanceof HTMLVideoElement ? node.videoWidth : 0))
        )
        .toBe(160)
      await video.evaluate(async (node) => {
        if (node instanceof HTMLVideoElement) {
          node.muted = true
          await node.play()
        }
      })
      await expect
        .poll(() =>
          video.evaluate((node) => (node instanceof HTMLVideoElement ? node.currentTime : 0))
        )
        .toBeGreaterThan(0)
      expect(requests).toEqual(expect.arrayContaining(['sample.m3u8', 'init.mp4', 'segment-0.m4s']))
      const hls = await video.elementHandle()
      if (!hls) throw new Error('Missing playing HLS element')
      await page.screenshot({ path: info.outputPath('hls-channel.png') })

      await navigate('My favorites')
      await expect(video).toHaveCount(0)
      expect(
        await hls.evaluate(
          (node) => node instanceof HTMLVideoElement && node.paused && !node.hasAttribute('src')
        )
      ).toBe(true)
      await hls.dispose()
      await page.getByRole('combobox').selectOption('Saved')
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
      await expect(
        page.getByText('Title when saved: Saved synthetic video', { exact: true })
      ).toBeVisible()
      await expect(
        page.getByText('Title when saved: Removed synthetic video', { exact: true })
      ).toHaveCount(0)
      await page.getByRole('button', { name: 'Select record', exact: true }).click()
      await page.getByRole('button', { name: 'Restore favorite', exact: true }).click()
      await expect(
        page.locator('form').getByRole('button', { name: 'Restore favorite', exact: true })
      ).toHaveCount(0)
      await page.getByRole('button', { name: 'Remove favorite', exact: true }).click()
      await expect(
        page.locator('form').getByRole('button', { name: 'Remove favorite', exact: true })
      ).toBeVisible()
      await page.getByRole('combobox').selectOption('Removed')
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
      await expect(
        page.getByText('Title when saved: Removed synthetic video', { exact: true })
      ).toHaveCount(1)
      // Preserve the generated 300 ms request throttle between record selections.
      await page.clock.fastForward(350)
      await page.getByRole('button', { name: 'Select record', exact: true }).click()
      await expect(
        page.getByText('Title when saved: Removed synthetic video', { exact: true })
      ).toHaveCount(2)
      await page.getByRole('button', { name: 'Restore favorite', exact: true }).click()
      await expect(
        page.locator('form').getByRole('button', { name: 'Restore favorite', exact: true })
      ).toBeVisible()
      expect(api.failures).toEqual([])
      expect(errors).toEqual([])
    } catch (error) {
      await info.attach('playback-diagnostics', {
        body: JSON.stringify({ errors, failures: api.failures, requests, url: page.url() }),
        contentType: 'application/json'
      })
      throw error
    } finally {
      await server.close()
    }
  })
}
