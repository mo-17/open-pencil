import { expect, test } from 'bun:test'

import { SkiaRenderer } from '@open-pencil/core'
import type { SceneNode } from '@open-pencil/scene-graph'

import { initCanvasKit } from '#cli/headless'
import { buildParagraph } from '#core/canvas/text'
import { fontManager } from '#core/text/fonts'
import { fontFaceDemand, fontResolver, missingGlyphCharacters } from '#core/text/resolver'

import { expectDefined } from '#tests/helpers/assert'

function textNode(family: string, fontWeight: number, italic = false): SceneNode {
  return {
    type: 'TEXT',
    text: '你好',
    fontSize: 32,
    fontFamily: family,
    fontWeight,
    italic,
    letterSpacing: 0,
    lineHeight: null,
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    textAutoResize: 'NONE',
    textDecoration: 'NONE',
    textDirection: 'AUTO',
    styleRuns: [],
    width: 240,
    height: 60
  } as SceneNode
}

test('renders the resolver-selected imported synthetic face without overriding exact faces', async () => {
  const ck = await initCanvasKit()
  const fontProvider = ck.TypefaceFontProvider.Make()
  const surface = expectDefined(ck.MakeSurface(240, 60), 'CanvasKit surface')
  const syntheticFamily = 'Imported Synthetic Candidate Fixture'
  const exactFamily = 'Imported Exact Candidate Fixture'
  const manager = fontManager as typeof fontManager & {
    cjkFallbackFamilies: string[]
    arabicFallbackFamilies: string[]
  }
  const previousCJKFallbacks = [...manager.cjkFallbackFamilies]
  const previousArabicFallbacks = [...manager.arabicFallbackFamilies]
  const previousCache = Reflect.get(fontManager, 'downloadedFontCache')
  const previousHostLoader = Reflect.get(fontManager, 'hostFontLoader')
  const previousProviders = new Set(fontManager.enabledOnlineFontProviders())
  const loadedFamilies = Reflect.get(fontManager, 'loadedFamilies') as Map<string, ArrayBuffer>
  const supplementalFamilyData = Reflect.get(fontManager, 'supplementalFamilyData') as Map<
    string,
    ArrayBuffer[]
  >
  const remoteCoverage = Reflect.get(fontManager, 'remoteCoverage') as Map<string, Set<string>>
  const importedRenderFamilies = Reflect.get(fontManager, 'importedRenderFamilies') as Map<
    string,
    string
  >
  const demands = [
    fontFaceDemand(syntheticFamily, 'Medium'),
    fontFaceDemand(syntheticFamily, 'Bold'),
    fontFaceDemand(syntheticFamily, 'Bold Italic'),
    fontFaceDemand(exactFamily, 'Bold'),
    fontFaceDemand(exactFamily, 'Regular Italic')
  ]

  fontManager.attachProvider(ck, fontProvider)
  fontManager.setDownloadedFontCache(null)
  fontManager.setHostFontLoader(null)
  fontManager.setOnlineFontProviders({
    google: false,
    fontsource: false,
    bunny: false,
    fontshare: false
  })
  manager.cjkFallbackFamilies = []
  manager.arabicFallbackFamilies = []

  try {
    const imported = await Bun.file('tests/fixtures/fonts/NotoSansSC-Regular.ttf').arrayBuffer()
    const exactBold = await Bun.file('packages/core/assets/Inter-Bold.ttf').arrayBuffer()
    const exactItalic = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    expect(await fontManager.registerImportedFontBytes(syntheticFamily, 'Regular', imported)).toBe(
      true
    )
    expect(await fontManager.registerImportedFontBytes(exactFamily, 'Regular', imported)).toBe(true)
    fontManager.markLoaded(exactFamily, 'Bold', exactBold)
    fontManager.markLoaded(exactFamily, 'Regular Italic', exactItalic)

    const snapshots = await Promise.all(
      demands.map((demand) => {
        fontResolver.reset(demand)
        return fontResolver.demand(demand)
      })
    )
    expect(snapshots.map((snapshot) => snapshot.candidate?.style)).toEqual([
      'Regular',
      'Regular',
      'Regular',
      'Bold',
      'Regular Italic'
    ])

    const renderer = new SkiaRenderer(ck, surface)
    renderer.fontsLoaded = true
    renderer.fontProvider = fontProvider
    const missing = (family: string, fontWeight: number, italic = false) => {
      const paragraph = buildParagraph(renderer, textNode(family, fontWeight, italic))
      paragraph.layout(240)
      const result = missingGlyphCharacters('你好', paragraph.getShapedLines())
      paragraph.delete()
      return result
    }

    expect(missing(syntheticFamily, 500)).toEqual([])
    expect(missing(syntheticFamily, 700)).toEqual([])
    expect(missing(syntheticFamily, 700, true)).toEqual([])
    expect(missing(exactFamily, 700)).toEqual(['你', '好'])
    expect(missing(exactFamily, 400, true)).toEqual(['你', '好'])
  } finally {
    for (const demand of demands) fontResolver.reset(demand)
    for (const family of [syntheticFamily, exactFamily]) {
      for (const style of ['Regular', 'Bold', 'Regular Italic']) {
        const key = `${family}|${style}`
        loadedFamilies.delete(key)
        supplementalFamilyData.delete(key)
        remoteCoverage.delete(key)
        importedRenderFamilies.delete(key)
      }
    }
    manager.cjkFallbackFamilies = previousCJKFallbacks
    manager.arabicFallbackFamilies = previousArabicFallbacks
    fontManager.setDownloadedFontCache(previousCache)
    fontManager.setHostFontLoader(previousHostLoader)
    fontManager.setOnlineFontProviders({
      google: previousProviders.has('google'),
      fontsource: previousProviders.has('fontsource'),
      bunny: previousProviders.has('bunny'),
      fontshare: previousProviders.has('fontshare')
    })
    fontManager.detachProvider(fontProvider)
    fontProvider.delete()
    surface.delete()
  }
})
