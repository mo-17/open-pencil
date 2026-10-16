import { describe, expect, test } from 'bun:test'

import {
  compareTextHistoryPixels,
  type TextHistoryComparisonInput,
  type TextHistoryRGB,
  type TextHistoryRGBaImage
} from '#core-tests/helpers/canvas/text-history'

const foreground: TextHistoryRGB = [0, 0, 0]
const background: TextHistoryRGB = [245, 247, 252]

function put(image: TextHistoryRGBaImage, x: number, y: number, rgb: TextHistoryRGB, alpha = 255) {
  image.pixels.set([...rgb, alpha], (y * image.width + x) * 4)
}

function fixture(): TextHistoryComparisonInput {
  const image: TextHistoryRGBaImage = { width: 9, height: 7, pixels: new Uint8Array(9 * 7 * 4) }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) put(image, x, y, background)
  }
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) put(image, x, y, foreground)
    put(image, 5, y, [122, 123, 126])
  }
  return {
    expected: image,
    actual: { ...image, pixels: image.pixels.slice() },
    regions: [{ x: 1, y: 1, width: 7, height: 5, foreground, background }],
    inkMask: { channel: 0, below: 40 }
  }
}

function change(
  input: TextHistoryComparisonInput,
  x: number,
  y: number,
  channel: number,
  delta: number
) {
  input.actual.pixels[(y * input.actual.width + x) * 4 + channel] += delta
}

function compareBothWays(input: TextHistoryComparisonInput) {
  const forward = compareTextHistoryPixels(input)
  const reverse = compareTextHistoryPixels({
    ...input,
    expected: input.actual,
    actual: input.expected
  })
  expect(reverse.matches).toBe(forward.matches)
  return forward
}

describe('solid text history edge contract', () => {
  test('preserves exact RGBA images', () => {
    const result = compareBothWays(fixture())
    expect(result.matches).toBe(true)
    expect(result.changedPixels).toBe(0)
    expect(result.allowedAaPixels).toBe(0)
  })

  test('allows one code value only on a witnessed solid-text coverage edge', () => {
    const input = fixture()
    change(input, 5, 3, 0, 1)
    const result = compareBothWays(input)
    expect(result.matches).toBe(true)
    expect(result.allowedAaPixels).toBe(1)
    expect(result.maxRgbDelta).toBe(1)
    expect(result.inkMaskDifferences).toBe(0)
  })

  test('does not depend on black glyphs, screenshot dimensions or a particular edge location', () => {
    const input = fixture()
    const ink: TextHistoryRGB = [20, 26, 46]
    const bg: TextHistoryRGB = [240, 242, 246]
    for (let y = 0; y < input.expected.height; y++) {
      for (let x = 0; x < input.expected.width; x++) put(input.expected, x, y, bg)
    }
    for (let y = 2; y <= 4; y++) {
      for (let x = 2; x <= 4; x++) put(input.expected, x, y, ink)
      put(input.expected, 5, y, [130, 134, 146])
    }
    input.actual.pixels = input.expected.pixels.slice()
    input.regions = [{ x: 1, y: 1, width: 7, height: 5, foreground: ink, background: bg }]
    change(input, 5, 2, 0, 1)
    expect(compareBothWays(input).matches).toBe(true)
  })

  test('rejects a dimension change', () => {
    const input = fixture()
    input.actual = { width: 10, height: 7, pixels: new Uint8Array(10 * 7 * 4) }
    expect(compareBothWays(input).matches).toBe(false)
  })

  test('rejects a one-code-value alpha change on an AA edge', () => {
    const input = fixture()
    change(input, 5, 3, 3, -1)
    const result = compareBothWays(input)
    expect(result.matches).toBe(false)
    expect(result.alphaDifferences).toBe(1)
  })

  test('rejects one-code-value background changes outside the text region', () => {
    const input = fixture()
    change(input, 0, 0, 0, 1)
    const result = compareBothWays(input)
    expect(result.matches).toBe(false)
    expect(result.outsideTextDifferences).toBe(1)
  })

  test('rejects background changes even inside the declared text box', () => {
    const input = fixture()
    change(input, 7, 1, 0, 1)
    const result = compareBothWays(input)
    expect(result.matches).toBe(false)
    expect(result.solidEndpointDifferences).toBe(1)
  })

  test('rejects one-code-value changes in the solid black glyph interior', () => {
    const input = fixture()
    change(input, 3, 3, 0, 1)
    const result = compareBothWays(input)
    expect(result.matches).toBe(false)
    expect(result.solidEndpointDifferences).toBe(1)
    expect(result.flatPixelDifferences).toBe(1)
  })

  test('rejects a two-code-value AA change', () => {
    const input = fixture()
    change(input, 5, 3, 0, 2)
    const result = compareBothWays(input)
    expect(result.matches).toBe(false)
    expect(result.excessiveRgbDifferences).toBe(1)
  })

  test('rejects a missing glyph', () => {
    const input = fixture()
    for (let y = 2; y <= 4; y++) {
      for (let x = 2; x <= 5; x++) put(input.actual, x, y, background)
    }
    const result = compareBothWays(input)
    expect(result.matches).toBe(false)
    expect(result.inkMaskDifferences).toBeGreaterThan(0)
  })

  test('rejects a one-pixel glyph translation despite retaining the ink count', () => {
    const input = fixture()
    for (let y = 1; y < 6; y++) {
      for (let x = 1; x < 8; x++) {
        const source = (y * input.expected.width + x - 1) * 4
        input.actual.pixels.set(
          input.expected.pixels.subarray(source, source + 4),
          (y * input.actual.width + x) * 4
        )
      }
    }
    const inkCount = (image: TextHistoryRGBaImage) => {
      let count = 0
      for (let i = 0; i < image.pixels.length; i += 4)
        if (image.pixels[i] < 40 && image.pixels[i + 3] === 255) count++
      return count
    }
    expect(inkCount(input.actual)).toBe(inkCount(input.expected))
    const result = compareBothWays(input)
    expect(result.matches).toBe(false)
    expect(result.inkMaskDifferences).toBeGreaterThan(0)
  })

  test('rejects a colored gradient left in the solid glyph', () => {
    const input = fixture()
    for (let y = 2; y <= 4; y++) {
      for (let x = 2; x <= 4; x++) put(input.actual, x, y, [30 + x * 10, 90, 170])
    }
    expect(compareBothWays(input).matches).toBe(false)
  })

  test('rejects a one-code-value change crossing the exact ink-mask threshold', () => {
    const input = fixture()
    put(input.expected, 5, 3, [39, 39, 40])
    input.actual.pixels = input.expected.pixels.slice()
    change(input, 5, 3, 0, 1)
    const result = compareBothWays(input)
    expect(result.matches).toBe(false)
    expect(result.inkMaskDifferences).toBe(1)
  })

  test('rejects an isolated nonflat gray patch within the text box', () => {
    const input = fixture()
    put(input.expected, 7, 2, [122, 123, 126])
    input.actual.pixels = input.expected.pixels.slice()
    change(input, 7, 2, 0, 1)
    const result = compareBothWays(input)
    expect(result.matches).toBe(false)
    expect(result.missingEdgeAnchorDifferences).toBe(1)
  })

  test('rejects changes to a flat coverage-colored fill', () => {
    const input = fixture()
    for (let y = 2; y <= 4; y++) {
      for (let x = 2; x <= 4; x++) put(input.expected, x, y, [122, 123, 126])
    }
    input.actual.pixels = input.expected.pixels.slice()
    change(input, 3, 3, 0, 1)
    const result = compareBothWays(input)
    expect(result.matches).toBe(false)
    expect(result.flatPixelDifferences).toBe(1)
  })

  test('rejects one-code-value chroma outside the shared coverage color line', () => {
    const input = fixture()
    input.regions = [{ x: 1, y: 1, width: 7, height: 5, foreground, background: [246, 246, 246] }]
    for (let y = 0; y < input.expected.height; y++) {
      for (let x = 0; x < input.expected.width; x++) put(input.expected, x, y, [246, 246, 246])
    }
    put(input.expected, 4, 3, foreground)
    put(input.expected, 5, 3, [122, 122, 123])
    input.actual.pixels = input.expected.pixels.slice()
    change(input, 5, 3, 2, 1)
    const result = compareBothWays(input)
    expect(result.matches).toBe(false)
    expect(result.offColorLineDifferences).toBe(1)
  })

  test('does not use a changed adjacent pixel as an AA anchor', () => {
    const input = fixture()
    change(input, 5, 3, 0, 1)
    for (let y = 2; y <= 4; y++) change(input, 4, y, 0, 1)
    const result = compareBothWays(input)
    expect(result.matches).toBe(false)
    expect(result.missingEdgeAnchorDifferences).toBeGreaterThan(0)
  })

  test('rejects malformed RGBA and overlapping or unbounded regions', () => {
    const input = fixture()
    expect(() =>
      compareTextHistoryPixels({ ...input, actual: { ...input.actual, pixels: new Uint8Array(1) } })
    ).toThrow(TypeError)
    expect(() =>
      compareTextHistoryPixels({ ...input, regions: [...input.regions, ...input.regions] })
    ).toThrow(TypeError)
    expect(() =>
      compareTextHistoryPixels({ ...input, regions: [{ ...input.regions[0], x: 9 }] })
    ).toThrow(TypeError)
  })
})
