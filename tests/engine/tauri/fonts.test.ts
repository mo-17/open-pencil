import { afterEach, describe, expect, test, vi } from 'bun:test'

import { fontFamilyLicenseDisplayForCatalog, fontManager } from '@open-pencil/core/text'

import { clearTauriMocks, mockTauriIPC } from '#tests/helpers/tauri/mocks'

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
})
