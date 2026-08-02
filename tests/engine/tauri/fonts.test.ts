import { afterEach, describe, expect, test, vi } from 'bun:test'

import { Font, Glyph, Path } from 'opentype.js'

import { resolveCompilerWebFonts } from '@open-pencil/compiler'
import {
  fontFaceDemand,
  fontFamilyLicenseDisplayForCatalog,
  fontManager,
  fontResolver,
  resetFontFamilyDemands
} from '@open-pencil/core/text'

import { createTauriDownloadedFontCache } from '@/app/editor/fonts/cache'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'
import { clearTauriMocks, mockTauriIPC } from '#tests/helpers/tauri/mocks'

function copiedBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
  }
  if (Array.isArray(value)) return Uint8Array.from(value)
  throw new Error('Expected binary mock payload')
}

function generatedFontBytes(family: string, style: string): ArrayBuffer {
  const glyphPath = new Path()
  glyphPath.moveTo(50, 0)
  glyphPath.lineTo(250, 700)
  glyphPath.lineTo(450, 0)
  glyphPath.close()
  return new Font({
    familyName: family,
    styleName: style,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [
      new Glyph({ name: '.notdef', advanceWidth: 500, path: new Path() }),
      new Glyph({ name: 'A', unicode: 65, advanceWidth: 500, path: glyphPath })
    ]
  }).toArrayBuffer()
}

afterEach(async () => {
  await clearTauriMocks()
  vi.restoreAllMocks()
  fontManager.setDownloadedFontCache(null)
  // The app font module owns this process-wide loader and configures it once.
  // Keep it installed while mockTauriIPC swaps the active IPC handler per test.
  fontManager.setWebFontFetch(null)
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'FontFace')
})

describe('Tauri font helpers', () => {
  test('lists and inspects system fonts through source-only Tauri IPC', async () => {
    const probeFamily = 'OpenPencil Local License Probe'
    const probeBytes = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    let probeLoads = 0
    await mockTauriIPC((cmd, args) => {
      if (cmd === 'list_system_fonts') {
        return [
          { family: 'System UI', styles: ['Regular', 'Bold'] },
          { family: 'Inter', styles: ['Regular'] },
          { family: probeFamily, styles: ['Bold'] }
        ]
      }
      expect(cmd).toBe('load_system_font')
      expect(args).toEqual({ family: probeFamily, style: 'Bold' })
      probeLoads++
      return probeBytes
    })

    vi.spyOn(fontManager, 'listFamilyOptions').mockResolvedValue([
      {
        family: 'Inter',
        source: 'bundled',
        licenseDisplay: fontFamilyLicenseDisplayForCatalog('Inter', 'bundled')
      }
    ])
    const { inspectFontFamilyLicense, listFamilies, listFonts } = await import('@/app/editor/fonts')

    const families = await listFamilies()
    expect(families).toEqual([
      {
        family: 'Inter',
        source: 'local',
        licenseDisplay: fontFamilyLicenseDisplayForCatalog('Inter', 'local')
      },
      {
        family: probeFamily,
        source: 'local',
        licenseDisplay: fontFamilyLicenseDisplayForCatalog(probeFamily, 'local')
      },
      {
        family: 'System UI',
        source: 'local',
        licenseDisplay: fontFamilyLicenseDisplayForCatalog('System UI', 'local')
      }
    ])
    await expect(listFonts()).resolves.toEqual([
      { family: 'System UI', styles: ['Regular', 'Bold'] },
      { family: 'Inter', styles: ['Regular'] },
      { family: probeFamily, styles: ['Bold'] }
    ])

    expect(fontManager.isLoaded(probeFamily)).toBe(false)
    const probeOption = families.find((option) => option.family === probeFamily)
    expect(probeOption).toBeDefined()
    if (!probeOption) return
    const displays = await Promise.all(
      Array.from({ length: 20 }, () => inspectFontFamilyLicense(probeOption))
    )
    expect(
      displays.every(
        (display) =>
          display.status === 'declared_open' && display.evidence === 'embedded_name_table'
      )
    ).toBe(true)
    expect(displays[0]).toMatchObject({ licenseIds: ['OFL-1.1'] })
    expect(probeLoads).toBe(1)
    expect(fontManager.isLoaded(probeFamily)).toBe(false)
  })

  test('loads system font bytes and registers the face', async () => {
    await mockTauriIPC((cmd, args) => {
      expect(cmd).toBe('load_system_font')
      expect(args).toEqual({ family: 'System UI', style: 'Bold Italic' })
      return Uint8Array.from([1, 2, 3, 4]).buffer
    })

    const { loadFont } = await import('@/app/editor/fonts')
    const buffer = await loadFont('System UI', 'Bold Italic')

    expect([...new Uint8Array(buffer ?? new ArrayBuffer(0))]).toEqual([1, 2, 3, 4])
    expect(fontManager.isStyleLoaded('System UI', 'Bold Italic')).toBe(true)
  })

  test('deduplicates twenty concurrent raw binary system font requests', async () => {
    let systemFontCalls = 0
    await mockTauriIPC((cmd) => {
      expect(cmd).toBe('load_system_font')
      systemFontCalls++
      return Uint8Array.from([0, 1, 0, 0, 4, 3, 2, 1]).buffer
    })

    const { loadFont } = await import('@/app/editor/fonts')
    const results = await Promise.all(
      Array.from({ length: 20 }, () => loadFont('Concurrent System UI', 'Regular'))
    )

    expect(systemFontCalls).toBe(1)
    expect(results.every((result) => result?.byteLength === 8)).toBe(true)
    expect(fontManager.retainedDataCount('Concurrent System UI')).toBe(1)
  })

  test('falls back to font manager loading when the system font command fails', async () => {
    await mockTauriIPC((cmd) => {
      expect(cmd).toBe('load_system_font')
      throw new Error('missing system font')
    })
    const fallback = new Uint8Array([9, 8, 7]).buffer
    const loadFontSpy = vi.spyOn(fontManager, 'loadFont').mockResolvedValue(fallback)

    const { loadFont } = await import('@/app/editor/fonts')

    await expect(loadFont('Missing Family', 'Regular')).resolves.toBe(fallback)
    expect(loadFontSpy).toHaveBeenCalledWith('Missing Family', 'Regular', '')
  })

  test('rolls back a staged manifest when persistence commits before its acknowledgement fails', async () => {
    const files = new Map<string, Uint8Array>()
    let manifestWrites = 0
    await mockTauriIPC((cmd, args, options) => {
      const payload = args as { path?: string }
      if (cmd === 'plugin:fs|read_file') {
        const stored = files.get(payload.path ?? '')
        if (!stored) throw new Error('missing')
        return [...stored]
      }
      if (cmd === 'plugin:fs|mkdir') return null
      if (cmd === 'plugin:fs|write_file') {
        const encodedPath = (options as { headers?: { path?: string } } | undefined)?.headers?.path
        const path = decodeURIComponent(encodedPath ?? '')
        files.set(path, copiedBytes(args))
        if (path.endsWith('/manifest') && ++manifestWrites === 1) {
          throw new Error('manifest write failed')
        }
        return null
      }
      if (cmd === 'plugin:fs|remove') {
        files.delete(payload.path ?? '')
        return null
      }
      throw new Error(`Unexpected command: ${cmd}`)
    })
    const register = vi.spyOn(fontManager, 'registerImportedFontBytes').mockResolvedValue(true)
    const { importFontBytes, importedFontRevision } = await import('@/app/editor/fonts')
    const { listImportedFontCacheFaces } = await import('@/app/editor/fonts/cache')
    const bytes = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    const revisionBefore = importedFontRevision.value
    const renderFamilyBefore = fontManager.renderFamily('Inter', 'Regular')

    await expect(importFontBytes(bytes)).rejects.toThrow('manifest write failed')

    expect(register).not.toHaveBeenCalled()
    await expect(listImportedFontCacheFaces()).resolves.toEqual([])
    const manifestBytes = files.get('cache/v1/font-cache/v1/manifest')
    expect(manifestBytes).toBeDefined()
    const manifestEnvelope = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      value?: { entries?: Record<string, unknown> }
    }
    expect(manifestEnvelope.value?.entries).toEqual({})
    expect(importedFontRevision.value).toBe(revisionBefore)
    expect(fontManager.renderFamily('Inter', 'Regular')).toBe(renderFamilyBefore)
    expect([...files.keys()].some((path) => path.includes('/files/'))).toBe(false)
  })

  test('rolls back persisted metadata when runtime font registration fails', async () => {
    const files = new Map<string, Uint8Array>()
    await mockTauriIPC((cmd, args, options) => {
      const payload = args as { path?: string }
      if (cmd === 'plugin:fs|read_file') {
        const stored = files.get(payload.path ?? '')
        if (!stored) throw new Error('missing')
        return [...stored]
      }
      if (cmd === 'plugin:fs|write_file') {
        const encodedPath = (options as { headers?: { path?: string } } | undefined)?.headers?.path
        if (!encodedPath) throw new Error('Expected write path header')
        files.set(decodeURIComponent(encodedPath), copiedBytes(args))
        return null
      }
      if (cmd === 'plugin:fs|mkdir') return null
      if (cmd === 'plugin:fs|remove') {
        files.delete(payload.path ?? '')
        return null
      }
      throw new Error(`Unexpected command: ${cmd}`)
    })
    vi.spyOn(fontManager, 'registerImportedFontBytes').mockResolvedValue(false)
    const { importFontBytes, importedFontRevision } = await import('@/app/editor/fonts')
    const { listImportedFontCacheFaces } = await import('@/app/editor/fonts/cache')
    const bytes = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    const revisionBefore = importedFontRevision.value

    await expect(importFontBytes(bytes)).rejects.toThrow('CanvasKit could not register')

    await expect(listImportedFontCacheFaces()).resolves.toEqual([])
    expect(importedFontRevision.value).toBe(revisionBefore)
    expect([...files.keys()].some((path) => path.includes('/files/'))).toBe(false)
  })

  test('invalidates settled synthetic family demands and refreshes compiler candidates after import', async () => {
    const files = new Map<string, Uint8Array>()
    await mockTauriIPC((cmd, args, options) => {
      const payload = args as { path?: string }
      if (cmd === 'plugin:fs|read_file') {
        const stored = files.get(payload.path ?? '')
        if (!stored) throw new Error('missing')
        return [...stored]
      }
      if (cmd === 'plugin:fs|write_file') {
        const encodedPath = (options as { headers?: { path?: string } } | undefined)?.headers?.path
        if (!encodedPath) throw new Error('Expected write path header')
        files.set(decodeURIComponent(encodedPath), copiedBytes(args))
        return null
      }
      if (cmd === 'plugin:fs|mkdir') return null
      throw new Error(`Unexpected command: ${cmd}`)
    })
    const family = 'Dynamic Imported Candidate'
    const otherFamily = 'Unrelated Settled Candidate'
    const demand = fontFaceDemand(family, 'Bold Italic')
    const otherDemand = fontFaceDemand(otherFamily, 'Bold Italic')
    const regular = generatedFontBytes(family, 'Regular')
    const italic = generatedFontBytes(family, 'Italic')
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
    const { importFontBytes, importedFontRevision } = await import('@/app/editor/fonts')
    const revisionBefore = importedFontRevision.value
    fontManager.setDownloadedFontCache(createTauriDownloadedFontCache())
    fontManager.setHostFontLoader(null)
    fontManager.setOnlineFontProviders({
      google: false,
      fontsource: false,
      bunny: false,
      fontshare: false
    })

    try {
      expect(await fontManager.registerImportedFontBytes(family, 'Regular', regular)).toBe(true)
      expect(await fontManager.registerImportedFontBytes(otherFamily, 'Regular', regular)).toBe(
        true
      )
      resetFontFamilyDemands(family)
      resetFontFamilyDemands(otherFamily)
      const before = await fontResolver.demand(demand)
      const unrelated = await fontResolver.demand(otherDemand)
      expect(before.candidate?.style).toBe('Regular')
      expect(unrelated.candidate?.style).toBe('Regular')

      await expect(importFontBytes(italic)).resolves.toMatchObject({ family, style: 'Italic' })
      expect(fontResolver.state(demand).state).toBe('idle')
      expect(fontResolver.state(otherDemand)).toBe(unrelated)

      const after = await fontResolver.demand(demand)
      expect(after.candidate?.style).toBe('Regular Italic')
      expect(fontManager.renderFamily(family, 'Regular Italic')).toStartWith(
        '__openpencil_imported_'
      )

      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      graph.createNode('TEXT', pageId, {
        text: 'A',
        fontFamily: family,
        fontWeight: 700,
        italic: true
      })
      const manifest = await resolveCompilerWebFonts({
        graph,
        pageIds: [pageId],
        providers: [],
        preferLoaded: true,
        refresh: true
      })
      const faces = manifest.faces.filter((face) => face.family === family)
      expect(faces).toHaveLength(1)
      expect(faces[0]).toMatchObject({ weight: 400, style: 'italic' })
      expect(faces[0].content).toEqual(new Uint8Array(italic))
    } finally {
      resetFontFamilyDemands(family)
      resetFontFamilyDemands(otherFamily)
      for (const targetFamily of [family, otherFamily]) {
        for (const style of ['Regular', 'Italic', 'Regular Italic']) {
          const key = `${targetFamily}|${style}`
          loadedFamilies.delete(key)
          supplementalFamilyData.delete(key)
          remoteCoverage.delete(key)
          importedRenderFamilies.delete(key)
        }
      }
      importedFontRevision.value = revisionBefore
      fontManager.setDownloadedFontCache(previousCache)
      fontManager.setHostFontLoader(previousHostLoader)
      fontManager.setOnlineFontProviders({
        google: previousProviders.has('google'),
        fontsource: previousProviders.has('fontsource'),
        bunny: previousProviders.has('bunny'),
        fontshare: previousProviders.has('fontshare')
      })
    }
  })
})
