import { describe, expect, test } from 'bun:test'

import type { CanvasKit, TypefaceFontProvider } from 'canvaskit-wasm'

import { FontManager, fontManager } from '@open-pencil/core/text'
import { SceneGraph } from '@open-pencil/scene-graph'

import { isTextPictureCurrent } from '#core/canvas/renderer/fonts'
import { nodeFontReadiness } from '#core/canvas/text'
import { fontFaceDemand, fontResolver } from '#core/text/resolver'

function pageId(graph: SceneGraph): string {
  return graph.getPages()[0].id
}

describe('font lifecycle', () => {
  test('advances generation only for provider epochs and unique registrations', () => {
    const manager = new FontManager()
    const registrations: string[] = []
    const provider = {
      registerFont(_data: ArrayBuffer, family: string) {
        registrations.push(family)
      }
    } as TypefaceFontProvider
    const data = new ArrayBuffer(12)

    expect(manager.generation()).toBe(0)
    manager.attachProvider({} as CanvasKit, provider)
    const providerGeneration = manager.generation()
    manager.markLoaded('Generation Test', 'Regular', data)
    const registrationGeneration = manager.generation()
    manager.markLoaded('Generation Test', 'Regular', data)

    expect(providerGeneration).toBeGreaterThan(0)
    expect(registrationGeneration).toBeGreaterThan(providerGeneration)
    expect(manager.generation()).toBe(registrationGeneration)
    expect(registrations).toEqual(['Generation Test'])
  })

  test('snapshots primary and supplemental face data without exposing retained buffers', () => {
    const manager = new FontManager()
    const latin = Uint8Array.from([0, 1, 0, 0, 1, 2, 3, 4]).buffer
    const cjk = Uint8Array.from([0, 1, 0, 0, 5, 6, 7, 8]).buffer

    manager.markLoaded('Shard Snapshot', 'Regular', latin)
    manager.markLoaded('Shard Snapshot', 'Regular', cjk)
    const snapshot = manager.loadedDataShards('Shard Snapshot', 'Regular')

    expect(snapshot).toHaveLength(2)
    expect(snapshot).not.toContain(latin)
    expect(snapshot).not.toContain(cjk)
    new Uint8Array(snapshot[0])[4] = 99
    expect(new Uint8Array(manager.loadedDataShards('Shard Snapshot', 'Regular')[0])[4]).toBe(5)
  })

  test('does not report a font as loaded when CanvasKit rejects its bytes', () => {
    const manager = new FontManager()
    const provider = {
      registerFont() {
        throw new Error('invalid font bytes')
      }
    } as TypefaceFontProvider

    manager.attachProvider({} as CanvasKit, provider)
    const generationBeforeLoad = manager.generation()
    manager.markLoaded('Rejected Font', 'Regular', new ArrayBuffer(12))

    expect(manager.isStyleLoaded('Rejected Font', 'Regular')).toBe(false)
    expect(manager.generation()).toBe(generationBeforeLoad)
  })

  test('does not treat retained bytes as loaded after a provider rejects replay', async () => {
    const manager = new FontManager()
    const data = new ArrayBuffer(12)
    const provider = {
      registerFont() {
        throw new Error('invalid retained font bytes')
      }
    } as TypefaceFontProvider

    manager.markLoaded('Rejected Retained Font', 'Regular', data)
    expect(manager.isStyleLoaded('Rejected Retained Font', 'Regular')).toBe(true)

    manager.attachProvider({} as CanvasKit, provider)
    const generationAfterAttach = manager.generation()
    manager.setOnlineFontProviders({ google: false, fontsource: false })

    expect(manager.isStyleLoaded('Rejected Retained Font', 'Regular')).toBe(false)
    await expect(manager.loadLocalFont('Rejected Retained Font', 'Regular')).resolves.toBeNull()
    await expect(manager.loadFont('Rejected Retained Font', 'Regular')).resolves.toBeNull()
    expect(manager.generation()).toBe(generationAfterAttach)
  })

  test('requires every active provider to accept a retained face', () => {
    const manager = new FontManager()
    const accepting = { registerFont: () => undefined } as TypefaceFontProvider
    const rejecting = {
      registerFont() {
        throw new Error('provider rejected font')
      }
    } as TypefaceFontProvider

    manager.attachProvider({} as CanvasKit, accepting)
    manager.markLoaded('Shared Canvas Font', 'Regular', new ArrayBuffer(12))
    expect(manager.isStyleLoaded('Shared Canvas Font', 'Regular')).toBe(true)

    manager.attachProvider({} as CanvasKit, rejecting)
    expect(manager.isStyleLoaded('Shared Canvas Font', 'Regular')).toBe(false)

    manager.detachProvider(rejecting)
    expect(manager.isStyleLoaded('Shared Canvas Font', 'Regular')).toBe(true)
  })

  test('does not persist or advance coverage for a remote face rejected by CanvasKit', async () => {
    const manager = new FontManager()
    const data = new ArrayBuffer(12)
    const rejecting = {
      registerFont() {
        throw new Error('invalid remote font bytes')
      }
    } as TypefaceFontProvider
    let cacheWrites = 0
    const webFonts = Reflect.get(manager, 'webFonts') as {
      fetchFont: () => Promise<ArrayBuffer[]>
    }
    webFonts.fetchFont = async () => [data]
    manager.setDownloadedFontCache({
      async read() {
        return null
      },
      async write() {
        cacheWrites++
      }
    })
    manager.attachProvider({} as CanvasKit, rejecting)

    await expect(
      manager.loadRemoteFont('Rejected Remote Font', 'Regular', 'ABC')
    ).resolves.toBeNull()
    expect(manager.isStyleLoaded('Rejected Remote Font', 'Regular')).toBe(false)
    expect(manager.remoteStyleNeedsCoverage('Rejected Remote Font', 'Regular', ['A'])).toBe(false)
    expect(cacheWrites).toBe(0)

    manager.detachProvider(rejecting)
    manager.attachProvider(
      {} as CanvasKit,
      { registerFont: () => undefined } as TypefaceFontProvider
    )
    await expect(manager.loadRemoteFont('Rejected Remote Font', 'Regular', 'ABC')).resolves.toBe(
      data
    )
    expect(manager.isStyleLoaded('Rejected Remote Font', 'Regular')).toBe(true)
    expect(cacheWrites).toBe(1)
  })

  test('keeps cumulative subset registrations under the source family', () => {
    const manager = new FontManager()
    const registrations: string[] = []
    const provider = {
      registerFont(_data: ArrayBuffer, family: string) {
        registrations.push(family)
      }
    } as TypefaceFontProvider

    manager.attachProvider({} as CanvasKit, provider)
    manager.markLoaded('Subset Font', 'Regular', new ArrayBuffer(8))
    const firstGeneration = manager.generation()
    manager.markLoaded('Subset Font', 'Regular', new ArrayBuffer(12))

    expect(manager.renderFamily('Subset Font', 'Regular')).toBe('Subset Font')
    expect(manager.generation()).toBeGreaterThan(firstGeneration)
    expect(registrations).toEqual(['Subset Font', 'Subset Font'])
  })

  test('deduplicates concurrent host loads and byte-identical buffers', async () => {
    const manager = new FontManager()
    const registrations: string[] = []
    const provider = {
      registerFont(_data: ArrayBuffer, family: string) {
        registrations.push(family)
      }
    } as TypefaceFontProvider
    let hostLoads = 0

    manager.attachProvider({} as CanvasKit, provider)
    manager.setHostFontLoader(async () => {
      hostLoads++
      await Promise.resolve()
      return Uint8Array.from([0, 1, 0, 0, 7, 8, 9, 10]).buffer
    })

    await Promise.all(
      Array.from({ length: 20 }, () => manager.loadFont('Bounded Host Font', 'Regular'))
    )
    manager.markLoaded(
      'Bounded Host Font',
      'Regular',
      Uint8Array.from([0, 1, 0, 0, 7, 8, 9, 10]).buffer
    )

    expect(hostLoads).toBe(1)
    expect(registrations).toEqual(['Bounded Host Font'])
    expect(manager.retainedDataCount('Bounded Host Font')).toBe(1)
  })

  test('restores an imported full face before a same-named system font', async () => {
    const manager = new FontManager()
    const imported = Uint8Array.from([0, 1, 0, 0, 7, 7, 7, 7]).buffer
    const system = Uint8Array.from([0, 1, 0, 0, 9, 9, 9, 9]).buffer
    let hostLoads = 0
    manager.setDownloadedFontCache({
      async read() {
        return null
      },
      async readImported(family, style) {
        expect([family, style]).toEqual(['Conflicting Face', 'Regular'])
        return imported
      },
      async write() {
        throw new Error('Unexpected cache write')
      }
    })
    manager.setHostFontLoader(async () => {
      hostLoads++
      return system
    })

    await expect(manager.loadFont('Conflicting Face', 'Regular')).resolves.toBe(imported)
    expect(hostLoads).toBe(0)
    expect(new Uint8Array(manager.loadedData('Conflicting Face', 'Regular') ?? [])).toEqual(
      new Uint8Array(imported)
    )
  })

  test('production resolver selects an imported face before the same-named system face', async () => {
    const family = 'Production Resolver Imported Priority'
    const imported = Uint8Array.from([0, 1, 0, 0, 4, 4, 4, 4]).buffer
    const system = Uint8Array.from([0, 1, 0, 0, 8, 8, 8, 8]).buffer
    const demand = fontFaceDemand(family, 'Regular')
    let hostLoads = 0
    let remoteCacheReads = 0

    fontManager.setDownloadedFontCache({
      async read() {
        remoteCacheReads++
        return null
      },
      async readImported() {
        return imported
      },
      async write() {
        throw new Error('Unexpected cache write')
      }
    })
    fontManager.setHostFontLoader(async () => {
      hostLoads++
      return system
    })
    fontResolver.reset(demand)

    try {
      await expect(fontResolver.demand(demand)).resolves.toMatchObject({
        state: 'loaded',
        source: 'imported'
      })
      expect(hostLoads).toBe(0)
      expect(remoteCacheReads).toBe(0)
      expect(new Uint8Array(fontManager.loadedData(family, 'Regular') ?? [])).toEqual(
        new Uint8Array(imported)
      )
    } finally {
      fontResolver.reset(demand)
      fontManager.setDownloadedFontCache(null)
      fontManager.setHostFontLoader(null)
    }
  })

  test('resolves twenty Simplified Chinese fallback requests after one host probe', async () => {
    const manager = new FontManager()
    const registrations: string[] = []
    const provider = {
      registerFont(_data: ArrayBuffer, family: string) {
        registrations.push(family)
      }
    } as TypefaceFontProvider
    let hostLoads = 0

    manager.attachProvider({} as CanvasKit, provider)
    manager.setFallbackUserAgent('Mozilla/5.0 (Macintosh)')
    manager.setHostFontLoader(async (family) => {
      hostLoads++
      return family === 'PingFang SC' ? Uint8Array.from([0, 1, 0, 0, 11, 12, 13, 14]).buffer : null
    })

    const results = []
    for (let index = 0; index < 20; index++) {
      results.push(await manager.ensureFallbackPack(['cjk-sc'], '中文'))
    }

    expect(results.every((result) => result['cjk-sc']?.[0] === 'Noto Sans SC')).toBe(true)
    expect(hostLoads).toBe(1)
    expect(registrations).toEqual(['Noto Sans SC'])
    expect(manager.retainedDataCount('Noto Sans SC')).toBe(1)
  })

  test('resolves Simplified Chinese and Korean through independent single flights', async () => {
    const manager = new FontManager()
    const loadedFamilies: string[] = []
    const fontData = Uint8Array.from([0, 1, 0, 0, 17, 18, 19, 20]).buffer

    manager.setFallbackUserAgent('Mozilla/5.0 (Macintosh)')
    manager.setHostFontLoader(async (family) => {
      loadedFamilies.push(family)
      return family === 'PingFang SC' || family === 'Apple SD Gothic Neo' ? fontData : null
    })

    const simplified = await manager.ensureFallbackPack(['cjk-sc'], '中文')
    const korean = await manager.ensureFallbackPack(['cjk-kr'], '환경설정')

    expect(simplified['cjk-sc']).toEqual(['Noto Sans SC'])
    expect(korean['cjk-kr']).toEqual(['Apple SD Gothic Neo'])
    expect(loadedFamilies).toEqual(['Noto Sans SC', 'Apple SD Gothic Neo'])
    expect(manager.getCJKFallbackFamilies()).toEqual(['Noto Sans SC', 'Apple SD Gothic Neo'])
  })

  test('finishes a missing remote coverage extension without recursive retries', async () => {
    const manager = new FontManager()
    const data = Uint8Array.from([0, 1, 0, 0, 21, 22, 23, 24]).buffer
    const remoteCoverage = Reflect.get(manager, 'remoteCoverage') as Map<string, Set<string>>
    let remoteLoads = 0

    manager.markLoaded('Remote Subset', 'Regular', data)
    remoteCoverage.set('Remote Subset|Regular', new Set('A'))
    Reflect.set(manager, 'loadRemoteFont', async () => {
      remoteLoads++
      return null
    })

    await expect(manager.loadFont('Remote Subset', 'Regular', '中')).resolves.toBe(data)
    expect(remoteLoads).toBe(1)
  })

  test('retries failed host loads instead of caching a transient null result', async () => {
    const manager = new FontManager()
    const data = Uint8Array.from([0, 1, 0, 0, 25, 26, 27, 28]).buffer
    let hostLoads = 0

    manager.setOnlineFontProviders({ google: false, fontsource: false })
    manager.setHostFontLoader(async () => {
      hostLoads++
      if (hostLoads === 1) throw new Error('temporary font IPC failure')
      return data
    })

    await expect(manager.loadFont('Retryable Host Font', 'Regular')).resolves.toBeNull()
    await expect(manager.loadFont('Retryable Host Font', 'Regular')).resolves.toBe(data)
    expect(hostLoads).toBe(2)
  })

  test('retries an unresolved fallback script after its sources become available', async () => {
    const manager = new FontManager()
    const data = Uint8Array.from([0, 1, 0, 0, 29, 30, 31, 32]).buffer
    let koreanAvailable = false

    manager.setFallbackUserAgent('Mozilla/5.0 (Macintosh)')
    manager.setHostFontLoader(async (family) =>
      koreanAvailable && family === 'Apple SD Gothic Neo' ? data : null
    )
    manager.loadFont = async () => null

    await expect(manager.ensureFallbackPack(['cjk-kr'], '환경설정')).resolves.toEqual({
      'cjk-kr': []
    })
    koreanAvailable = true
    await expect(manager.ensureFallbackPack(['cjk-kr'], '환경설정')).resolves.toEqual({
      'cjk-kr': ['Apple SD Gothic Neo']
    })
  })

  test('lets a caller abort without duplicating or cancelling the shared host load', async () => {
    const manager = new FontManager()
    const controller = new AbortController()
    let releaseHostLoad: ((data: ArrayBuffer) => void) | undefined
    let hostLoads = 0

    manager.setHostFontLoader(
      () =>
        new Promise((resolve) => {
          hostLoads++
          releaseHostLoad = resolve
        })
    )

    const cancelled = manager.loadFont('Abortable Host Font', 'Regular', '', {
      signal: controller.signal
    })
    const surviving = manager.loadFont('Abortable Host Font', 'Regular')
    controller.abort(new Error('stop font wait'))

    await expect(cancelled).rejects.toThrow('stop font wait')
    releaseHostLoad?.(Uint8Array.from([0, 1, 0, 0, 3, 4, 5, 6]).buffer)
    await expect(surviving).resolves.toHaveProperty('byteLength', 8)
    expect(hostLoads).toBe(1)
    expect(manager.retainedDataCount('Abortable Host Font')).toBe(1)
  })

  test('rejects a pre-aborted load before invoking the host loader', async () => {
    const manager = new FontManager()
    const controller = new AbortController()
    let hostLoads = 0

    manager.setHostFontLoader(async () => {
      hostLoads++
      return new ArrayBuffer(8)
    })
    controller.abort(new Error('already stopped'))

    await expect(
      manager.loadFont('Pre-aborted Host Font', 'Regular', '', { signal: controller.signal })
    ).rejects.toThrow('already stopped')
    expect(hostLoads).toBe(0)
  })

  test('tracks nodes gated by pre-render font resolution', () => {
    const manager = new FontManager()
    manager.blockNodesUntilFontsResolve(['first', 'second'])
    expect(manager.isNodeBlocked('first')).toBe(true)
    expect(manager.isNodeBlocked('second')).toBe(true)
    manager.unblockNodes(['first'])
    expect(manager.isNodeBlocked('first')).toBe(false)
    expect(manager.isNodeBlocked('second')).toBe(true)
  })

  test('rejects a text picture observed before the font generation changed', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('TEXT', pageId(graph), {
      name: 'Cached fallback',
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      text: 'Hello',
      textPicture: new Uint8Array([1, 2, 3])
    })
    const renderer = {
      fontGeneration: 1,
      textPictureGenerations: new Map<string, { data: Uint8Array; generation: number }>()
    }

    expect(isTextPictureCurrent(renderer, node)).toBe(true)
    renderer.fontGeneration = 2
    expect(isTextPictureCurrent(renderer, node)).toBe(false)
  })

  test('keeps text visible when an unavailable italic face can use a loaded family face', () => {
    const family = 'Missing Italic Regression'
    const demand = fontFaceDemand(family, 'Regular Italic', 'Hello')
    fontResolver.reset(demand)
    fontResolver.exhaust(demand)
    fontManager.markLoaded(family, 'Regular', new ArrayBuffer(12))

    const graph = new SceneGraph()
    const node = graph.createNode('TEXT', pageId(graph), {
      name: 'Synthetic italic',
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      text: 'Hello',
      fontFamily: family,
      italic: true
    })

    expect(nodeFontReadiness({}, node)).toBe('ready')
    fontResolver.reset(demand)
  })
})
