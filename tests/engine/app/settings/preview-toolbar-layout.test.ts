import { describe, expect, test } from 'bun:test'

import { resolvePreviewToolbarBand } from '@/app/lowcode/preview-pane/toolbar-layout'
import {
  DEFAULT_PREVIEW_TOOLBAR_LAYOUT,
  PREVIEW_TOOLBAR_LAYOUTS,
  repairStoredPreviewToolbarLayout
} from '@/app/settings/preview-toolbar-layout'

describe('preview toolbar layout setting', () => {
  test.each(PREVIEW_TOOLBAR_LAYOUTS)('accepts and preserves %s', (value) => {
    const writes: string[] = []

    expect(repairStoredPreviewToolbarLayout(value, (layout) => writes.push(layout))).toBe(value)
    expect(writes).toEqual([])
  })

  test.each([undefined, null, '', 'wide', 3, { layout: 'adaptive' }])(
    'falls back and repairs invalid persisted value %#',
    (value) => {
      const writes: string[] = []

      expect(repairStoredPreviewToolbarLayout(value, (layout) => writes.push(layout))).toBe(
        DEFAULT_PREVIEW_TOOLBAR_LAYOUT
      )
      expect(writes).toEqual([DEFAULT_PREVIEW_TOOLBAR_LAYOUT])
    }
  )

  test.each([
    [0, 'tiny'],
    [319, 'tiny'],
    [320, 'narrow'],
    [559, 'narrow'],
    [560, 'medium'],
    [879, 'medium'],
    [880, 'wide']
  ] as const)('maps %d px to the %s responsive band', (width, band) => {
    expect(resolvePreviewToolbarBand(width)).toBe(band)
  })
})
