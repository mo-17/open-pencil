export type TextHistoryRGB = readonly [number, number, number]

export interface TextHistoryRGBaImage {
  width: number
  height: number
  pixels: Uint8Array | Uint8ClampedArray
}

export interface SolidTextAaRegion {
  x: number
  y: number
  width: number
  height: number
  foreground: TextHistoryRGB
  background: TextHistoryRGB
}

export interface TextHistoryComparisonInput {
  expected: TextHistoryRGBaImage
  actual: TextHistoryRGBaImage
  regions: readonly SolidTextAaRegion[]
  inkMask: { channel: 0 | 1 | 2; below: number }
}

export interface TextHistoryComparison {
  matches: boolean
  sameDimensions: boolean
  changedPixels: number
  allowedAaPixels: number
  rejectedPixels: number
  maxRgbDelta: number
  alphaDifferences: number
  inkMaskDifferences: number
  outsideTextDifferences: number
  solidEndpointDifferences: number
  flatPixelDifferences: number
  offColorLineDifferences: number
  missingEdgeAnchorDifferences: number
  excessiveRgbDifferences: number
}

/**
 * Compare two opaque solid-text rasters without granting a tolerance to a whole text box.
 * Regions must describe authored solid text over the specified flat background, without overlap.
 * All runtime helpers are local so Playwright can serialize this exact function unchanged.
 */
export function compareTextHistoryPixels(input: TextHistoryComparisonInput): TextHistoryComparison {
  const { expected, actual, regions, inkMask } = input
  const validByte = (value: number) => Number.isInteger(value) && value >= 0 && value <= 255
  const validateImage = (image: TextHistoryRGBaImage) => {
    if (
      !Number.isSafeInteger(image.width) ||
      !Number.isSafeInteger(image.height) ||
      image.width <= 0 ||
      image.height <= 0 ||
      !(image.pixels instanceof Uint8Array || image.pixels instanceof Uint8ClampedArray) ||
      image.pixels.length !== image.width * image.height * 4
    ) {
      throw new TypeError('Text history requires complete positive-size 8-bit RGBA images')
    }
  }
  validateImage(expected)
  validateImage(actual)
  if (![0, 1, 2].includes(inkMask.channel) || !validByte(inkMask.below) || inkMask.below === 0) {
    throw new TypeError('Text history requires an explicit nonempty opaque-ink threshold')
  }
  const validateRegion = (region: SolidTextAaRegion) => {
    if (
      ![region.x, region.y, region.width, region.height].every(Number.isSafeInteger) ||
      region.x < 0 ||
      region.y < 0 ||
      region.width <= 0 ||
      region.height <= 0 ||
      region.x + region.width > expected.width ||
      region.y + region.height > expected.height ||
      region.foreground.length !== 3 ||
      region.background.length !== 3 ||
      ![...region.foreground, ...region.background].every(validByte) ||
      region.foreground.every((value, channel) => value === region.background[channel]) ||
      region.foreground[inkMask.channel] >= inkMask.below ||
      region.background[inkMask.channel] < inkMask.below
    ) {
      throw new TypeError('Text history requires in-bounds solid text regions with distinct colors')
    }
  }
  const validateRegions = () => {
    for (const region of regions) validateRegion(region)
    for (let a = 0; a < regions.length; a++) {
      for (let b = a + 1; b < regions.length; b++) {
        const first = regions[a]
        const second = regions[b]
        if (
          first.x < second.x + second.width &&
          second.x < first.x + first.width &&
          first.y < second.y + second.height &&
          second.y < first.y + first.height
        ) {
          throw new TypeError('Text history regions must not overlap')
        }
      }
    }
  }
  validateRegions()
  const stats: TextHistoryComparison = {
    matches: false,
    sameDimensions: expected.width === actual.width && expected.height === actual.height,
    changedPixels: 0,
    allowedAaPixels: 0,
    rejectedPixels: 0,
    maxRgbDelta: 0,
    alphaDifferences: 0,
    inkMaskDifferences: 0,
    outsideTextDifferences: 0,
    solidEndpointDifferences: 0,
    flatPixelDifferences: 0,
    offColorLineDifferences: 0,
    missingEdgeAnchorDifferences: 0,
    excessiveRgbDifferences: 0
  }
  if (!stats.sameDimensions) return stats

  const isInk = (pixels: TextHistoryRGBaImage['pixels'], offset: number) =>
    pixels[offset + 3] === 255 && pixels[offset + inkMask.channel] < inkMask.below
  const rgbEquals = (
    pixels: TextHistoryRGBaImage['pixels'],
    offset: number,
    color: TextHistoryRGB
  ) => color.every((value, channel) => pixels[offset + channel] === value)
  const pixelEquals = (offset: number) =>
    expected.pixels[offset] === actual.pixels[offset] &&
    expected.pixels[offset + 1] === actual.pixels[offset + 1] &&
    expected.pixels[offset + 2] === actual.pixels[offset + 2] &&
    expected.pixels[offset + 3] === actual.pixels[offset + 3]
  const inRegion = (region: SolidTextAaRegion, x: number, y: number) =>
    x >= region.x && y >= region.y && x < region.x + region.width && y < region.y + region.height
  const onColorLine = (
    pixels: TextHistoryRGBaImage['pixels'],
    offset: number,
    region: SolidTextAaRegion
  ) => {
    // A single coverage value must explain all three independently rounded channels.
    let lower = 0
    let upper = 1
    for (let channel = 0; channel < 3; channel++) {
      const span = region.background[channel] - region.foreground[channel]
      const value = pixels[offset + channel] - region.foreground[channel]
      if (span === 0) {
        if (value !== 0) return false
        continue
      }
      const first = (value - 0.5) / span
      const second = (value + 0.5) / span
      lower = Math.max(lower, Math.min(first, second))
      upper = Math.min(upper, Math.max(first, second))
    }
    return lower <= upper
  }
  const flatAt = (pixels: TextHistoryRGBaImage['pixels'], offset: number, x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= expected.width || ny >= expected.height) continue
        const neighbor = (ny * expected.width + nx) * 4
        for (let channel = 0; channel < 4; channel++) {
          if (pixels[offset + channel] !== pixels[neighbor + channel]) return false
        }
      }
    }
    return true
  }
  const hasEdgeAnchors = (x: number, y: number, region: SolidTextAaRegion) => {
    let background = false
    let ink = false
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (!inRegion(region, nx, ny)) continue
        const neighbor = (ny * expected.width + nx) * 4
        // Anchors are unchanged opaque observations, not permissively recolored neighbors.
        if (!pixelEquals(neighbor) || expected.pixels[neighbor + 3] !== 255) continue
        if (rgbEquals(expected.pixels, neighbor, region.background)) background = true
        if (isInk(expected.pixels, neighbor) && onColorLine(expected.pixels, neighbor, region))
          ink = true
      }
    }
    return background && ink
  }

  const rejectChangedPixel = (
    offset: number,
    x: number,
    y: number,
    maxDelta: number,
    alphaChanged: boolean,
    maskChanged: boolean
  ): boolean => {
    const region = regions.find((candidate) => inRegion(candidate, x, y))
    let rejected = alphaChanged || maskChanged
    if (maxDelta > 1) {
      stats.excessiveRgbDifferences++
      rejected = true
    }
    if (!region) {
      stats.outsideTextDifferences++
      rejected = true
    } else {
      if (expected.pixels[offset + 3] !== 255 || actual.pixels[offset + 3] !== 255) rejected = true
      if (
        [expected.pixels, actual.pixels].some(
          (pixels) =>
            rgbEquals(pixels, offset, region.foreground) ||
            rgbEquals(pixels, offset, region.background)
        )
      ) {
        stats.solidEndpointDifferences++
        rejected = true
      }
      if (flatAt(expected.pixels, offset, x, y) || flatAt(actual.pixels, offset, x, y)) {
        stats.flatPixelDifferences++
        rejected = true
      }
      if (
        !onColorLine(expected.pixels, offset, region) ||
        !onColorLine(actual.pixels, offset, region)
      ) {
        stats.offColorLineDifferences++
        rejected = true
      }
      if (!hasEdgeAnchors(x, y, region)) {
        stats.missingEdgeAnchorDifferences++
        rejected = true
      }
    }
    return rejected
  }

  for (let offset = 0; offset < expected.pixels.length; offset += 4) {
    const alphaChanged = expected.pixels[offset + 3] !== actual.pixels[offset + 3]
    const maskChanged = isInk(expected.pixels, offset) !== isInk(actual.pixels, offset)
    if (alphaChanged) stats.alphaDifferences++
    if (maskChanged) stats.inkMaskDifferences++
    let maxDelta = 0
    for (let channel = 0; channel < 3; channel++) {
      maxDelta = Math.max(
        maxDelta,
        Math.abs(expected.pixels[offset + channel] - actual.pixels[offset + channel])
      )
    }
    stats.maxRgbDelta = Math.max(stats.maxRgbDelta, maxDelta)
    if (maxDelta === 0 && !alphaChanged) continue
    stats.changedPixels++
    const x = (offset / 4) % expected.width
    const y = Math.floor(offset / 4 / expected.width)
    const rejected = rejectChangedPixel(offset, x, y, maxDelta, alphaChanged, maskChanged)
    if (rejected) stats.rejectedPixels++
    else stats.allowedAaPixels++
  }
  stats.matches =
    stats.rejectedPixels === 0 && stats.alphaDifferences === 0 && stats.inkMaskDifferences === 0
  return stats
}
