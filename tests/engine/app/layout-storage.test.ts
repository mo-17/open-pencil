import { describe, expect, test } from 'bun:test'

import { editorPanelDefaultSizes, previewPanelDefaultSize } from '@/app/shell/layout-storage'

describe('editor layout storage sizing', () => {
  test('reserves preview space when loading a legacy three-panel layout', () => {
    const sizes = editorPanelDefaultSizes([18, 64, 18], true)

    expect(sizes[0]).toBeCloseTo(14.4)
    expect(sizes[1]).toBeCloseTo(51.2)
    expect(sizes[2]).toBeCloseTo(14.4)
    expect(
      sizes.reduce((sum, size) => sum + size, 0) + previewPanelDefaultSize([18, 64, 18])
    ).toBeCloseTo(100)
  })

  test('preserves a saved collapsed preview layout without over-allocation', () => {
    const saved = [17, 54, 27, 2]
    const sizes = editorPanelDefaultSizes(saved, true)

    expect(sizes).toEqual([17, 54, 27])
    expect(sizes.reduce((sum, size) => sum + size, 0) + previewPanelDefaultSize(saved)).toBe(100)
  })

  test('reclaims preview space when the preview is unavailable', () => {
    const sizes = editorPanelDefaultSizes([16, 48, 16, 20], false)

    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(100)
    expect(sizes[1] / sizes[0]).toBeCloseTo(3)
  })

  test('rejects invalid saved preview sizes', () => {
    expect(previewPanelDefaultSize([10, 10, 10, 80])).toBe(20)
  })
})
