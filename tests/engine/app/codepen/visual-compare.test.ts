import { describe, expect, test } from 'bun:test'

import { AI_VISUAL_COMPARE_VIEWPORTS, type AIVisualViewport } from '@open-pencil/core/ai-draft'

import { compareCodePenRGBA, preflightCodePenVisualArtifact } from '@/app/codepen/visual-compare'

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(45)
  const view = new DataView(bytes.buffer)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes.set([8, 6, 0, 0, 0], 24)
  bytes.set([0x49, 0x45, 0x4e, 0x44], 37)
  return bytes
}

function writeUint24LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
}

function webpHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  const view = new DataView(bytes.buffer)
  bytes.set([0x52, 0x49, 0x46, 0x46])
  view.setUint32(4, bytes.byteLength - 8, true)
  bytes.set([0x57, 0x45, 0x42, 0x50], 8)
  bytes.set([0x56, 0x50, 0x38, 0x58], 12)
  view.setUint32(16, 10, true)
  writeUint24LE(bytes, 24, width - 1)
  writeUint24LE(bytes, 27, height - 1)
  return bytes
}

function artifact(
  bytes: Uint8Array,
  mediaType: 'image/png' | 'image/webp',
  viewport: AIVisualViewport
) {
  return { bytes, mediaType, width: viewport.width, height: viewport.height } as const
}

describe('CodePen pixel comparison', () => {
  test('returns zero for identical RGBA pixels', () => {
    const pixels = new Uint8ClampedArray([0, 128, 255, 255, 20, 30, 40, 50])
    expect(compareCodePenRGBA(pixels, pixels.slice())).toBe(0)
  })

  test('normalizes absolute channel difference to zero through one', () => {
    expect(
      compareCodePenRGBA(
        new Uint8ClampedArray([0, 0, 0, 0]),
        new Uint8ClampedArray([255, 255, 255, 255])
      )
    ).toBe(1)
    expect(
      compareCodePenRGBA(new Uint8ClampedArray([0, 0, 0, 0]), new Uint8ClampedArray([255, 0, 0, 0]))
    ).toBe(0.25)
  })

  test('rejects mismatched or empty buffers', () => {
    expect(() => compareCodePenRGBA(new Uint8ClampedArray(), new Uint8ClampedArray())).toThrow()
    expect(() =>
      compareCodePenRGBA(new Uint8ClampedArray([0]), new Uint8ClampedArray([0, 1]))
    ).toThrow()
  })
})

describe('CodePen visual artifact preflight', () => {
  test('accepts complete PNG and WebP headers for all three fixed viewports', () => {
    for (const viewport of AI_VISUAL_COMPARE_VIEWPORTS) {
      const png = preflightCodePenVisualArtifact(
        artifact(pngHeader(viewport.width, viewport.height), 'image/png', viewport),
        viewport
      )
      const webp = preflightCodePenVisualArtifact(
        artifact(webpHeader(viewport.width, viewport.height), 'image/webp', viewport),
        viewport
      )

      expect([png.width, png.height, png.mediaType]).toEqual([
        viewport.width,
        viewport.height,
        'image/png'
      ])
      expect([webp.width, webp.height, webp.mediaType]).toEqual([
        viewport.width,
        viewport.height,
        'image/webp'
      ])
    }
  })

  test('fails closed for unknown and malformed image bytes', () => {
    const viewport = AI_VISUAL_COMPARE_VIEWPORTS[0]
    expect(() =>
      preflightCodePenVisualArtifact(
        artifact(new Uint8Array([1, 2, 3, 4]), 'image/png', viewport),
        viewport
      )
    ).toThrow(/complete PNG or WebP header/)
    expect(() =>
      preflightCodePenVisualArtifact(
        artifact(pngHeader(viewport.width, viewport.height).subarray(0, 33), 'image/png', viewport),
        viewport
      )
    ).toThrow(/complete PNG or WebP header/)
  })

  test('rejects encoded media-type mismatches before decoding', () => {
    const viewport = AI_VISUAL_COMPARE_VIEWPORTS[1]
    expect(() =>
      preflightCodePenVisualArtifact(
        artifact(webpHeader(viewport.width, viewport.height), 'image/png', viewport),
        viewport
      )
    ).toThrow(/media type does not match/)
  })

  test('enforces the fixed dimensions and per-viewport pixel budget', () => {
    const viewport = AI_VISUAL_COMPARE_VIEWPORTS[0]
    expect(() =>
      preflightCodePenVisualArtifact(
        artifact(pngHeader(viewport.width, viewport.height - 1), 'image/png', viewport),
        viewport
      )
    ).toThrow(/must be exactly 360×800/)
    expect(() =>
      preflightCodePenVisualArtifact(
        artifact(webpHeader(viewport.width + 1, viewport.height), 'image/webp', viewport),
        viewport
      )
    ).toThrow(/288000 pixel budget/)
  })

  test('rejects forged viewport metadata outside the fixed comparison contract', () => {
    const viewport = { id: 'mobile', width: 720, height: 1_600 }
    expect(() =>
      preflightCodePenVisualArtifact(
        { bytes: pngHeader(720, 1_600), mediaType: 'image/png', width: 720, height: 1_600 },
        viewport
      )
    ).toThrow(/Unsupported visual comparison viewport/)
  })
})
