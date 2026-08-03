import { describe, expect, test } from 'bun:test'

import { FontManager } from '@open-pencil/core'

import { expectDefined } from '#tests/helpers/assert'

/**
 * Offline CJK fallback. CJK text rendered with a Latin font (e.g. Inter) needs
 * a CJK fallback face in the renderer or it draws `.notdef` boxes. The fallback
 * loader prefers local system fonts, but Tauri's WKWebView has no Local Font
 * Access API and browsers need an explicit permission grant, so those paths
 * silently fail and the loader would otherwise depend on fetching Noto Sans SC
 * from Google Fonts (network). Bundling Noto Sans SC as a local asset makes the
 * fallback resolve offline — loadFont consults BUNDLED_FONTS before the network.
 */
describe('offline CJK fallback (bundled Noto Sans SC)', () => {
  test('loadFont resolves Noto Sans SC from the bundled asset without network', async () => {
    const fm = new FontManager()
    const buffer = await fm.loadFont('Noto Sans SC', 'Regular')
    const data = expectDefined(buffer, 'bundled Noto Sans SC bytes')
    // A real CJK font is multi-MB; a stub/pointer or a failed fetch would not be.
    expect(data.byteLength).toBeGreaterThan(1_000_000)
  })

  test('the CJK fallback pack reuses the bundled face without network', async () => {
    const fm = new FontManager()

    const families = await fm.ensureFallbackPack(['cjk-sc'], '整理行囊')

    expect(families['cjk-sc']).toContain('Noto Sans SC')
    expect(fm.getCJKFallbackFamilies()).toContain('Noto Sans SC')
  })

  test('Simplified Chinese avoids copying a platform TTC when the bundled face is available', async () => {
    const fm = new FontManager()
    const hostRequests: string[] = []
    fm.setFallbackUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    fm.setHostFontLoader(async (family) => {
      hostRequests.push(family)
      return family === 'PingFang SC' ? new ArrayBuffer(1024) : null
    })

    const families = await fm.ensureFallbackPack(['cjk-sc'], '整理行囊')

    expect(families['cjk-sc']).toEqual(['Noto Sans SC'])
    expect(hostRequests).not.toContain('PingFang SC')
  })
})
