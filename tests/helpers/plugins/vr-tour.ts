import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

import { VR_TOUR_SAMPLE_ASSETS } from '@open-pencil/core/plugins'

/** Default CI uses the unchanged package-source bytes; live mode verifies the public CDN. */
export async function observeVRTourSampleDownloads(page: Page, live = false) {
  const requests: string[] = []
  page.on('request', (request) => {
    if (VR_TOUR_SAMPLE_ASSETS.some((asset) => asset.downloadUrl === request.url()))
      requests.push(request.url())
  })
  if (!live) {
    for (const asset of VR_TOUR_SAMPLE_ASSETS) {
      await page.route(asset.downloadUrl, (route) =>
        route.fulfill({
          contentType: 'image/jpeg',
          headers: { 'access-control-allow-origin': '*' },
          body: readFileSync(join('packages/demos/vr-tour', asset.fileName))
        })
      )
    }
  }
  return requests
}
