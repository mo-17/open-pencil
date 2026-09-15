import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { VR_TOUR_COPY, VR_TOUR_COPY_SOURCE } from '#compiler/adapters/vr-tour/copy'
import { VR_TOUR_IMAGE_HEADER_SOURCE } from '#compiler/adapters/vr-tour/image-header'
import { VR_TOUR_RUNTIME_SOURCE } from '#compiler/adapters/vr-tour/source'

import { compileTour } from './helpers'

const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  VR_TOUR_COPY_SOURCE + VR_TOUR_IMAGE_HEADER_SOURCE
)
const directory = mkdtempSync(join(tmpdir(), 'openpencil-vr-i18n-'))
const modulePath = join(directory, 'runtime.mjs')
writeFileSync(modulePath, source)
afterAll(() => rmSync(directory, { recursive: true, force: true }))
const runtime = await import(pathToFileURL(modulePath).href)

describe('generated VR locale contract', () => {
  test('an explicit locale selects all viewer and status copy while old configs remain English', () => {
    expect(runtime.tourCopy()).toEqual(VR_TOUR_COPY.en)
    expect(runtime.tourCopy('en')).toEqual(VR_TOUR_COPY.en)
    expect(runtime.tourCopy('zh-CN')).toEqual(VR_TOUR_COPY['zh-CN'])
    expect(runtime.tourCopy('unsupported')).toEqual(VR_TOUR_COPY.en)
    expect(Object.keys(VR_TOUR_COPY['zh-CN'])).toEqual(Object.keys(VR_TOUR_COPY.en))
    for (const [key, value] of Object.entries(VR_TOUR_COPY.en)) {
      if (key === 'viewer') continue
      const translated = Reflect.get(VR_TOUR_COPY['zh-CN'], key)
      expect(typeof translated).toBe('string')
      expect(translated).not.toBe(value)
      expect(translated.length).toBeGreaterThan(0)
    }
    expect(Object.keys(VR_TOUR_COPY['zh-CN'].viewer)).toEqual(Object.keys(VR_TOUR_COPY.en.viewer))
    for (const [key, value] of Object.entries(VR_TOUR_COPY.en.viewer)) {
      expect(Reflect.get(VR_TOUR_COPY['zh-CN'].viewer, key)).not.toBe(value)
    }
  })

  test('pre-decode image errors use the selected locale and retain a known-error identity', () => {
    const invalidDimensions = () =>
      runtime.panoramaDimensions(new Uint8Array(), 'image/png', 'zh-CN')
    expect(invalidDimensions).toThrow(VR_TOUR_COPY['zh-CN'].invalidDimensions)
    expect(invalidDimensions).toThrow(runtime.PanoramaError)
    expect(() => runtime.panoramaDimensions(new Uint8Array(), 'image/png')).toThrow(
      VR_TOUR_COPY.en.invalidDimensions
    )
    const malformedWebP = new Uint8Array(20)
    malformedWebP.set(new TextEncoder().encode('RIFF'), 0)
    malformedWebP.set(new TextEncoder().encode('WEBP'), 8)
    new DataView(malformedWebP.buffer).setUint32(4, 100, true)
    expect(() => runtime.panoramaDimensions(malformedWebP, 'image/webp', 'zh-CN')).toThrow(
      VR_TOUR_COPY['zh-CN'].invalidWebPHeader
    )
    expect(() => runtime.panoramaDimensions(malformedWebP, 'image/webp')).toThrow(
      VR_TOUR_COPY.en.invalidWebPHeader
    )
  })

  test('both export targets carry localized controls, PSV overlays and safe error handling', () => {
    for (const target of ['react', 'vue'] as const) {
      const files = compileTour(target).files
      const extension = target === 'react' ? 'tsx' : 'vue'
      const emitted = String(files.get(`src/__openpencil_vr_tour.${extension}`))
      expect(emitted).toContain('locale?: TourLocale')
      expect(emitted).toContain('lang: { ...copy.viewer }')
      expect(emitted).toContain("toolbar.setAttribute('aria-label', copy.toolbar)")
      expect(emitted).toContain("viewport.setAttribute('aria-label', copy.viewport)")
      expect(emitted).toContain('copy.viewer.zoomOut')
      expect(emitted).toContain('copy.viewer.zoomIn')
      expect(emitted).toContain(
        'panoramaDimensions(new Uint8Array(await blob.arrayBuffer()), mime, locale)'
      )
      expect(emitted).toContain('error instanceof PanoramaError ? error.message : copy.unavailable')
      expect(emitted).toContain(VR_TOUR_COPY['zh-CN'].load)
      expect(emitted).not.toContain('navigator.language')
    }
    expect(VR_TOUR_RUNTIME_SOURCE).not.toContain('error instanceof Error ? error.message')
  })
})
