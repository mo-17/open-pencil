import { describe, expect, test } from 'bun:test'

import type { CanvasKit, TypefaceFontProvider } from 'canvaskit-wasm'

import {
  FontManager,
  MAX_IMPORTED_FONT_BYTES,
  inspectImportedFontBytes,
  missingGlyphCharacters
} from '@open-pencil/core/text'

import { initCanvasKit } from '#cli/headless'

describe('imported font files', () => {
  test('reads the internal face identity and reviewed license from valid bytes', async () => {
    const bytes = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()

    const inspection = await inspectImportedFontBytes(bytes)

    expect(inspection).toMatchObject({
      family: 'Inter',
      style: 'Regular',
      format: 'truetype',
      byteLength: bytes.byteLength,
      licenseDisplay: {
        status: 'free',
        evidence: 'reviewed_bundled_manifest',
        licenseIds: ['OFL-1.1']
      }
    })
    expect(inspection.postscriptName).toBeTruthy()
  })

  test('rejects damaged, unsupported, and oversized files before registration', async () => {
    await expect(inspectImportedFontBytes(new Uint8Array([1, 2, 3, 4]).buffer)).rejects.toThrow(
      'Only valid TTF, OTF, and WOFF'
    )
    await expect(
      inspectImportedFontBytes(new Uint8Array(MAX_IMPORTED_FONT_BYTES + 1).buffer)
    ).rejects.toThrow('32 MiB or smaller')
  })

  test('registers the inspected bytes once for CanvasKit and exposes byte-identical shards', async () => {
    const bytes = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    const manager = new FontManager()
    const registrations: Array<{ family: string; bytes: ArrayBuffer }> = []
    const provider = {
      registerFont(data: ArrayBuffer, family: string) {
        registrations.push({ family, bytes: data })
      }
    } as TypefaceFontProvider
    manager.attachProvider({} as CanvasKit, provider)

    expect(await manager.registerImportedFontBytes('Inter', 'Regular', bytes)).toBe(true)
    const generationAfterFirstImport = manager.generation()
    expect(await manager.registerImportedFontBytes('Inter', 'Regular', bytes.slice(0))).toBe(true)
    expect(manager.generation()).toBe(generationAfterFirstImport)

    const renderFamily = manager.renderFamily('Inter', 'Regular')
    expect(renderFamily).toStartWith('__openpencil_imported_')
    expect(manager.renderFamily('Inter', 'Medium')).toBe('Inter')
    expect(manager.renderFamily('Inter', 'Bold')).toBe('Inter')
    expect(manager.renderFamily('Inter', 'Bold Italic')).toBe('Inter')
    expect(registrations).toEqual([{ family: renderFamily, bytes }])
    const [compilerBytes] = manager.loadedDataShards('Inter', 'Regular')
    expect(compilerBytes).not.toBe(bytes)
    expect(new Uint8Array(compilerBytes)).toEqual(new Uint8Array(bytes))
  })

  test('explicitly replaces a same-named CanvasKit face and exports only imported bytes', async () => {
    const ck = await initCanvasKit()
    const provider = ck.TypefaceFontProvider.Make()
    const manager = new FontManager()
    manager.attachProvider(ck, provider)
    const system = await Bun.file('packages/core/assets/Inter-Regular.ttf').arrayBuffer()
    const imported = await Bun.file('tests/fixtures/fonts/NotoSansSC-Regular.ttf').arrayBuffer()

    try {
      manager.markLoaded('Imported Replacement', 'Regular', system)
      expect(manager.loadedDataShards('Imported Replacement', 'Regular')).toHaveLength(1)

      expect(
        await manager.registerImportedFontBytes('Imported Replacement', 'Regular', imported)
      ).toBe(true)
      const renderFamily = manager.renderFamily('Imported Replacement', 'Regular')
      expect(renderFamily).toStartWith('__openpencil_imported_')
      expect(manager.renderFamily('Imported Replacement', 'Bold')).toBe('Imported Replacement')
      expect(manager.renderFamily('Imported Replacement', 'Bold Italic')).toBe(
        'Imported Replacement'
      )

      const builder = ck.ParagraphBuilder.MakeFromFontProvider(
        new ck.ParagraphStyle({
          textStyle: {
            color: ck.BLACK,
            fontFamilies: [renderFamily],
            fontSize: 32
          }
        }),
        provider
      )
      builder.addText('你好世界')
      const paragraph = builder.build()
      paragraph.layout(300)
      expect(missingGlyphCharacters('你好世界', paragraph.getShapedLines())).toEqual([])
      expect(paragraph.getLongestLine()).toBeGreaterThan(0)
      paragraph.delete()

      const shards = manager.loadedDataShards('Imported Replacement', 'Regular')
      expect(shards).toHaveLength(1)
      expect(new Uint8Array(shards[0])).toEqual(new Uint8Array(imported))

      manager.markLoaded('Imported Replacement', 'Regular', system)
      expect(manager.loadedDataShards('Imported Replacement', 'Regular')).toHaveLength(1)
    } finally {
      manager.detachProvider(provider)
      provider.delete()
    }
  })
})
