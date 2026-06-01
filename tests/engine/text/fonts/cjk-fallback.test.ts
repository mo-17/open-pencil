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
})
