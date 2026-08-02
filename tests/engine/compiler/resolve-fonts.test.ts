import { describe, expect, test } from 'bun:test'

import { resolveCompilerWebFonts } from '@open-pencil/compiler'
import {
  fontCoverageDemand,
  fontFaceDemand,
  fontManager,
  fontResolver,
  type FontFallbackScript,
  WEB_FONT_PROVIDER_IDS
} from '@open-pencil/core/text'

import { fontBytesWithFsType } from '#tests/helpers/font-fixtures'
import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

describe('resolveCompilerWebFonts', () => {
  test('reuses the canvas resolver synthetic Regular result without network access', async () => {
    const family = 'OpenPencil Compiler Resolver Fixture'
    const previousProviders = new Set(fontManager.enabledOnlineFontProviders())
    fontManager.setOnlineFontProviders(
      Object.fromEntries(WEB_FONT_PROVIDER_IDS.map((provider) => [provider, false]))
    )
    const regularLatin = new Uint8Array([0, 1, 0, 0, 0, 12, 0, 1]).buffer
    const regularCJK = new Uint8Array([0, 1, 0, 0, 0, 12, 0, 2]).buffer
    fontManager.markLoaded(family, 'Regular', regularLatin)
    fontManager.markLoaded(family, 'Regular', regularCJK)
    fontResolver.reset(fontFaceDemand(family, 'Bold'))

    try {
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      graph.createNode('TEXT', pageId, { text: 'Fixture', fontFamily: family, fontWeight: 700 })
      const manifest = await resolveCompilerWebFonts({
        graph,
        pageIds: [pageId],
        providers: [],
        preferLoaded: true,
        refresh: true
      })
      const resolvedFaces = manifest.faces.filter((face) => face.family === family)
      expect(resolvedFaces).toHaveLength(2)
      expect(new Set(resolvedFaces.map((face) => face.path)).size).toBe(2)
      expect(resolvedFaces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            family,
            weight: 400,
            style: 'normal',
            format: 'truetype'
          })
        ])
      )
      expect(resolvedFaces.map((face) => face.content.at(-1)).sort()).toEqual([1, 2])
    } finally {
      fontManager.setOnlineFontProviders(
        Object.fromEntries(
          WEB_FONT_PROVIDER_IDS.map((provider) => [provider, previousProviders.has(provider)])
        )
      )
    }
  })

  test('invalidates a cached plan when glyph coverage changes within one provider subset', async () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const text = graph.createNode('TEXT', pageId, {
      text: 'A',
      fontFamily: 'Cache Coverage Fixture',
      fontWeight: 400
    })
    const input = { graph, pageIds: [pageId], providers: [] }

    const latinA = resolveCompilerWebFonts({ ...input, refresh: true })
    await latinA
    graph.updateNode(text.id, { text: 'B' })
    const latinB = resolveCompilerWebFonts(input)

    expect(latinB).not.toBe(latinA)
    await latinB
    graph.updateNode(text.id, { text: 'BB' })
    expect(resolveCompilerWebFonts(input)).toBe(latinB)
  })

  test('exports each script-specific fallback face for mixed CJK text', async () => {
    const simplifiedFamily = 'OpenPencil Compiler Simplified Fixture'
    const koreanFamily = 'OpenPencil Compiler Korean Fixture'
    const fallbackState = Reflect.get(fontManager, 'fallbackFamiliesByScript') as Map<
      FontFallbackScript,
      string[]
    >
    const previousFallbackState = new Map(
      [...fallbackState].map(([script, families]) => [script, [...families]])
    )
    fallbackState.clear()
    fallbackState.set('cjk-sc', [simplifiedFamily])
    fallbackState.set('cjk-kr', [koreanFamily])
    fontManager.markLoaded(
      simplifiedFamily,
      'Regular',
      new Uint8Array([0, 1, 0, 0, 0, 12, 1, 1]).buffer
    )
    fontManager.markLoaded(
      koreanFamily,
      'Regular',
      new Uint8Array([0, 1, 0, 0, 0, 12, 2, 2]).buffer
    )
    fontResolver.reset(fontCoverageDemand('cjk-sc'))
    fontResolver.reset(fontCoverageDemand('cjk-kr'))

    try {
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      graph.createNode('TEXT', pageId, { text: '汉한' })
      const manifest = await resolveCompilerWebFonts({
        graph,
        pageIds: [pageId],
        providers: [],
        preferLoaded: true,
        refresh: true
      })

      expect(manifest.fallbackFamilies).toEqual([simplifiedFamily, koreanFamily])
      expect(manifest.faces.map((face) => face.family)).toEqual(
        expect.arrayContaining([simplifiedFamily, koreanFamily])
      )
    } finally {
      fallbackState.clear()
      for (const [script, families] of previousFallbackState) {
        fallbackState.set(script, families)
      }
      fontResolver.reset(fontCoverageDemand('cjk-sc'))
      fontResolver.reset(fontCoverageDemand('cjk-kr'))
    }
  })

  test('carries exact bundled-license evidence into the compiler manifest', async () => {
    await fontManager.loadFont('Inter', 'Regular')
    fontResolver.reset(fontFaceDemand('Inter', 'Regular'))
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('TEXT', pageId, { text: 'Bundled license' })
    const manifest = await resolveCompilerWebFonts({
      graph,
      pageIds: [pageId],
      providers: [],
      preferLoaded: true,
      refresh: true
    })

    expect(manifest.faces.find((face) => face.family === 'Inter')?.licenseEvidence).toEqual({
      kind: 'verified_open',
      licenseIds: ['OFL-1.1']
    })
  })

  test('preserves restricted OS/2 embedding provenance on loaded face assets', async () => {
    const family = 'Compiler Restricted Embedding Fixture'
    const style = 'Regular'
    const key = `${family}|${style}`
    const demand = fontFaceDemand(family, style)
    const source = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    const restricted = fontBytesWithFsType(source, 0x0002)
    const loadedFamilies = Reflect.get(fontManager, 'loadedFamilies') as Map<string, ArrayBuffer>
    const supplementalFamilyData = Reflect.get(fontManager, 'supplementalFamilyData') as Map<
      string,
      ArrayBuffer[]
    >
    const remoteCoverage = Reflect.get(fontManager, 'remoteCoverage') as Map<string, Set<string>>
    fontManager.markLoaded(family, style, restricted)
    fontResolver.reset(demand)

    try {
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      graph.createNode('TEXT', pageId, {
        text: 'Restricted',
        fontFamily: family,
        fontWeight: 400
      })
      const manifest = await resolveCompilerWebFonts({
        graph,
        pageIds: [pageId],
        providers: [],
        preferLoaded: true,
        refresh: true
      })

      expect(manifest.faces.find((face) => face.family === family)?.licenseEvidence).toEqual({
        kind: 'restricted',
        restriction: 'embedding',
        fsType: 0x0002
      })
    } finally {
      fontResolver.reset(demand)
      loadedFamilies.delete(key)
      supplementalFamilyData.delete(key)
      remoteCoverage.delete(key)
    }
  })

  test('exports only the imported full face after replacing same-named loaded bytes', async () => {
    const family = 'Compiler Imported Replacement Fixture'
    const style = 'Regular'
    const key = `${family}|${style}`
    const demand = fontFaceDemand(family, style)
    const system = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    const imported = await Bun.file('packages/core/assets/Inter-Bold.ttf').arrayBuffer()
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
    fontManager.markLoaded(family, style, system)
    expect(await fontManager.registerImportedFontBytes(family, style, imported)).toBe(true)
    fontResolver.reset(demand)

    try {
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      graph.createNode('TEXT', pageId, { text: 'Imported', fontFamily: family, fontWeight: 400 })
      const manifest = await resolveCompilerWebFonts({
        graph,
        pageIds: [pageId],
        providers: [],
        preferLoaded: true,
        refresh: true
      })
      const faces = manifest.faces.filter((face) => face.family === family)

      expect(faces).toHaveLength(1)
      expect(faces[0].path).not.toContain('-2.')
      expect(faces[0].content).toEqual(new Uint8Array(imported))
    } finally {
      fontResolver.reset(demand)
      loadedFamilies.delete(key)
      supplementalFamilyData.delete(key)
      remoteCoverage.delete(key)
      importedRenderFamilies.delete(key)
    }
  })
})
