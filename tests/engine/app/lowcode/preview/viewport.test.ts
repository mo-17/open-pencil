import { describe, expect, test } from 'bun:test'

import { usePreviewViewport } from '@/app/lowcode/preview-pane/viewport/use'

describe('ephemeral preview viewport controls', () => {
  test('starts fitted with remembered phone dimensions and simulation disabled', () => {
    const controls = usePreviewViewport()
    expect(controls.viewport.value).toBe('fit')
    expect([controls.width.value, controls.height.value]).toEqual([390, 844])
    expect(controls.frameStyle.value).toEqual({ width: '100%', height: '100%' })
    expect(controls.textScale.value).toBe(1)
    expect(controls.keyboard.value).toBe(false)
    expect(controls.diagnostics.value).toBe(false)
  })

  test.each([
    ['phone', 390, 844],
    ['landscape', 844, 390],
    ['tablet', 768, 1024],
    ['desktop', 1440, 1000]
  ] as const)(
    '%s selects its real dimensions without a new preview session',
    (preset, width, height) => {
      const controls = usePreviewViewport()
      controls.viewport.value = preset
      expect([controls.width.value, controls.height.value]).toEqual([width, height])
      expect(controls.frameStyle.value).toEqual({
        width: `${width}px`,
        minWidth: `${width}px`,
        height: `${height}px`,
        marginInline: 'auto'
      })
    }
  )

  test('continuous width edits enter custom and retain the current preset height', () => {
    const controls = usePreviewViewport()
    controls.viewport.value = 'landscape'
    for (const width of [844, 845, 700, 547]) {
      controls.width.value = width
      expect<unknown>(controls.viewport.value).toBe('custom')
      expect(controls.width.value).toBe(width)
      expect(controls.height.value).toBe(390)
    }
    expect(controls.frameStyle.value.height).toBe('390px')
  })

  test('height edits enter custom without resetting the current width', () => {
    const controls = usePreviewViewport()
    controls.viewport.value = 'desktop'
    controls.height.value = 740
    expect<unknown>(controls.viewport.value).toBe('custom')
    expect([controls.width.value, controls.height.value]).toEqual([1440, 740])
  })

  test('fit preserves dimensions for the next custom edit', () => {
    const controls = usePreviewViewport()
    controls.width.value = 430
    controls.height.value = 932
    controls.viewport.value = 'fit'
    expect(controls.frameStyle.value).toEqual({ width: '100%', height: '100%' })
    expect([controls.width.value, controls.height.value]).toEqual([430, 932])
    controls.width.value = 431
    expect<unknown>(controls.viewport.value).toBe('custom')
    expect(controls.height.value).toBe(932)
  })

  test('dimension edits round finite pixels and stay within 240..2560', () => {
    const controls = usePreviewViewport()
    controls.width.value = -20
    controls.height.value = 9999
    expect([controls.width.value, controls.height.value]).toEqual([240, 2560])
    controls.width.value = 612.6
    expect(controls.width.value).toBe(613)
  })

  test('non-finite input leaves both dimensions and the selected preset intact', () => {
    const controls = usePreviewViewport()
    controls.viewport.value = 'phone'
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      controls.width.value = invalid
      controls.height.value = invalid
      expect(controls.viewport.value).toBe('phone')
      expect([controls.width.value, controls.height.value]).toEqual([390, 844])
    }
  })

  test('invalid model values cannot select an unknown mode or text scale', () => {
    const controls = usePreviewViewport()
    controls.viewport.value = 'tablet'
    Reflect.set(controls.viewport, 'value', 'unknown')
    expect(controls.viewport.value).toBe('tablet')
    controls.textScale.value = 1.6
    for (const invalid of [1.5, Number.NaN, '2', null]) {
      Reflect.set(controls.textScale, 'value', invalid)
      expect(controls.textScale.value).toBe(1.6)
    }
  })

  test('Web simulation controls preserve dimensions while accepting supported scales', () => {
    const controls = usePreviewViewport()
    controls.viewport.value = 'phone'
    const initialStyle = controls.frameStyle.value
    for (const scale of [1, 1.3, 1.6, 2] as const) {
      controls.textScale.value = scale
      expect(controls.textScale.value).toBe(scale)
    }
    controls.keyboard.value = true
    controls.diagnostics.value = true
    expect(controls.viewport.value).toBe('phone')
    expect(controls.frameStyle.value).toEqual(initialStyle)
    expect([controls.width.value, controls.height.value]).toEqual([390, 844])
  })

  test('new panes receive independent session settings', () => {
    const first = usePreviewViewport()
    const second = usePreviewViewport()
    first.width.value = 600
    first.keyboard.value = true
    first.diagnostics.value = true
    first.textScale.value = 2
    expect(second.viewport.value).toBe('fit')
    expect(second.width.value).toBe(390)
    expect(second.keyboard.value).toBe(false)
    expect(second.diagnostics.value).toBe(false)
    expect(second.textScale.value).toBe(1)
  })
})
