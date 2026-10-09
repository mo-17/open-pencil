import { describe, expect, spyOn, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import type { CanvasKit, Image, Surface } from 'canvaskit-wasm'

import { SceneGraph } from '@open-pencil/scene-graph'

import { renderModulePreview } from '#core/canvas/modules/registry'
import { SkiaRenderer } from '#core/canvas/renderer'
import { initCanvasKit } from '#core/io/formats/raster/headless'
import {
  EFFECT_PICK_CATALOG,
  createEffectPickModuleFrameOverrides
} from '#core/plugins/effect-pick'
import { fontManager } from '#core/text/fonts'
import { collectGraphFontKeys, collectGraphFontRequirements } from '#core/text/requirements'
import { missingGlyphCharacters } from '#core/text/resolver'

const EXPANSION_VERSION = '0.7.0'
const RASTER_PADDING = 16

function expansionEntries() {
  const entries = EFFECT_PICK_CATALOG.filter(
    (entry) => entry.collectionVersion === EXPANSION_VERSION
  )
  expect(entries).toHaveLength(20)
  return entries
}

function readPixels(ck: CanvasKit, surface: Surface, width: number, height: number) {
  const image = surface.makeImageSnapshot()
  try {
    return readImagePixels(ck, image, width, height)
  } finally {
    image.delete()
  }
}

function readImagePixels(ck: CanvasKit, image: Image, width: number, height: number) {
  return expectDefined(
    image.readPixels(0, 0, {
      width,
      height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB
    })
  )
}

function inspectPixels(
  pixels: Uint8Array | Float32Array,
  surfaceWidth: number,
  nodeWidth: number,
  nodeHeight: number
) {
  let painted = 0
  let escaped = 0
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] === 0) continue
    painted++
    const pixel = (index - 3) / 4
    const x = (pixel % surfaceWidth) - RASTER_PADDING
    const y = Math.floor(pixel / surfaceWidth) - RASTER_PADDING
    if (x < 0 || y < 0 || x >= nodeWidth || y >= nodeHeight) escaped++
  }
  return { painted, escaped }
}

describe('EffectPick static canvas content', () => {
  test('prepares current module text and Chinese effect names without materializing text nodes', () => {
    const graph = new SceneGraph()
    const page = expectDefined(graph.getPages()[0])
    for (const entry of EFFECT_PICK_CATALOG) {
      const node = graph.createNode('FRAME', page.id, {
        ...createEffectPickModuleFrameOverrides({ effectId: entry.id, text: '当前文案 Current' }),
        textLanguage: 'zh-CN'
      })
      const before = structuredClone([...graph.getAllNodes()])
      const requirements = collectGraphFontRequirements(graph, [node.id])
      const projected = expectDefined(requirements.nodes[0])
      expect(projected.id).toBe(node.id)
      expect(projected.type).toBe('TEXT')
      expect(projected.text).toContain('当前文案 Current')
      if (entry.id !== 'diagonal-fill') expect(projected.text).toContain(entry.title)
      expect(requirements.scripts).toContain('cjk-sc')
      expect(collectGraphFontKeys(graph, [node.id])).toContainEqual(['Inter', 'SemiBold'])
      expect([...graph.getAllNodes()]).toEqual(before)
      expect(node.childIds).toEqual([])
    }
  })

  test('draws bounded resting content and preserves transparent colors and the authored graph', async () => {
    const ck = await initCanvasKit()
    const surface = expectDefined(ck.MakeSurface(360, 140))
    const renderer = new SkiaRenderer(ck, surface)
    const provider = ck.TypefaceFontProvider.Make()
    const semibold = await Bun.file(
      new URL('../../../assets/Inter-SemiBold.ttf', import.meta.url)
    ).arrayBuffer()
    fontManager.attachProvider(ck, provider)
    fontManager.markLoaded('Inter', 'SemiBold', semibold)
    renderer.fontProvider = provider
    renderer.fontsLoaded = true
    const canvas = surface.getCanvas()
    const graph = new SceneGraph()
    const page = expectDefined(graph.getPages()[0])
    const node = graph.createNode('FRAME', page.id, {
      ...createEffectPickModuleFrameOverrides({ text: 'Create', color: '#80e0c2' }),
      width: 224,
      height: 101
    })
    const pixels = () => {
      const image = surface.makeImageSnapshot()
      try {
        return expectDefined(
          image.readPixels(0, 0, {
            width: 360,
            height: 140,
            colorType: ck.ColorType.RGBA_8888,
            alphaType: ck.AlphaType.Unpremul,
            colorSpace: ck.ColorSpace.SRGB
          })
        )
      } finally {
        image.delete()
      }
    }
    try {
      const before = structuredClone([...graph.getAllNodes()])
      canvas.clear(ck.TRANSPARENT)
      expect(renderModulePreview(renderer, canvas, node, graph)).toBe(true)
      const rendered = pixels()
      let painted = 0
      for (let y = 0; y < 140; y++) {
        for (let x = 0; x < 360; x++) {
          if (rendered[(y * 360 + x) * 4 + 3] === 0) continue
          painted++
          expect(x).toBeLessThan(node.width)
          expect(y).toBeLessThan(node.height)
        }
      }
      expect(painted).toBeGreaterThan(100)
      expect([...graph.getAllNodes()]).toEqual(before)
      expect(node.childIds).toEqual([])
      renderer.fontsLoaded = false
      for (const effectId of ['diagonal-fill', 'animated-gradient']) {
        graph.updateNode(
          node.id,
          createEffectPickModuleFrameOverrides({ effectId, text: '', color: '#80e0c200' })
        )
        canvas.clear(ck.TRANSPARENT)
        expect(renderModulePreview(renderer, canvas, node, graph)).toBe(true)
        expect(pixels().every((value, index) => index % 4 !== 3 || value === 0)).toBe(true)
      }
    } finally {
      renderer.destroy()
    }
  })

  test('draws all twenty expansion entries inside their hosts without fonts or graph changes', async () => {
    const ck = await initCanvasKit()
    const entries = expansionEntries()
    const surfaceWidth =
      Math.ceil(Math.max(...entries.map((entry) => entry.defaultSize.width))) + RASTER_PADDING * 2
    const surfaceHeight =
      Math.ceil(Math.max(...entries.map((entry) => entry.defaultSize.height))) + RASTER_PADDING * 2
    const surface = expectDefined(ck.MakeSurface(surfaceWidth, surfaceHeight))
    const renderer = new SkiaRenderer(ck, surface)
    const canvas = surface.getCanvas()
    try {
      expect(renderer.fontsLoaded).toBe(false)
      for (const entry of entries) {
        const graph = new SceneGraph()
        const page = expectDefined(graph.getPages()[0])
        const node = graph.createNode(
          'FRAME',
          page.id,
          createEffectPickModuleFrameOverrides({ effectId: entry.id })
        )
        expect(node.fills).toEqual([])
        expect(node.strokes).toEqual([])
        const sizes = [entry.defaultSize, { width: 224, height: 101 }, { width: 80, height: 32 }]
        for (const size of sizes) {
          graph.updateNode(node.id, size)
          const before = structuredClone([...graph.getAllNodes()])
          canvas.clear(ck.TRANSPARENT)
          canvas.save()
          canvas.translate(RASTER_PADDING, RASTER_PADDING)
          try {
            expect(renderModulePreview(renderer, canvas, node, graph)).toBe(true)
          } finally {
            canvas.restore()
          }
          const ink = inspectPixels(
            readPixels(ck, surface, surfaceWidth, surfaceHeight),
            surfaceWidth,
            node.width,
            node.height
          )
          expect(ink.painted, `${entry.id} ${size.width}×${size.height}`).toBeGreaterThan(0)
          expect(ink.escaped, `${entry.id} ${size.width}×${size.height}`).toBe(0)
          expect([...graph.getAllNodes()]).toEqual(before)
          expect(node.childIds).toEqual([])
          expect(node.fills).toEqual([])
          expect(node.strokes).toEqual([])
        }
        for (const size of [
          { width: 0, height: 32 },
          { width: 80, height: 0 }
        ]) {
          graph.updateNode(node.id, size)
          canvas.clear(ck.TRANSPARENT)
          expect(renderModulePreview(renderer, canvas, node, graph)).toBe(true)
          expect(
            inspectPixels(
              readPixels(ck, surface, surfaceWidth, surfaceHeight),
              surfaceWidth,
              node.width,
              node.height
            ).painted
          ).toBe(0)
        }
      }
    } finally {
      renderer.destroy()
    }
  })

  test('keeps every expansion family transparent when both configured colors have zero alpha', async () => {
    const ck = await initCanvasKit()
    const surface = expectDefined(ck.MakeSurface(256, 133))
    const renderer = new SkiaRenderer(ck, surface)
    const canvas = surface.getCanvas()
    try {
      for (const entry of expansionEntries()) {
        const graph = new SceneGraph()
        const page = expectDefined(graph.getPages()[0])
        const node = graph.createNode('FRAME', page.id, {
          ...createEffectPickModuleFrameOverrides({
            effectId: entry.id,
            color: '#80e0c200',
            secondaryColor: '#fbbf2400'
          }),
          width: 224,
          height: 101
        })
        const before = structuredClone([...graph.getAllNodes()])
        canvas.clear(ck.TRANSPARENT)
        expect(renderModulePreview(renderer, canvas, node, graph)).toBe(true)
        expect(
          readPixels(ck, surface, 256, 133).every((value, index) => index % 4 !== 3 || value === 0),
          entry.id
        ).toBe(true)
        expect([...graph.getAllNodes()]).toEqual(before)
        expect(node.childIds).toEqual([])
      }
    } finally {
      renderer.destroy()
    }
  })

  test('renders current mixed text using local font faces and preserves alpha with fonts loaded', async () => {
    const ck = await initCanvasKit()
    const surface = expectDefined(ck.MakeSurface(256, 133))
    const renderer = new SkiaRenderer(ck, surface)
    const provider = ck.TypefaceFontProvider.Make()
    const inter = await Bun.file(
      new URL('../../../assets/Inter-SemiBold.ttf', import.meta.url)
    ).arrayBuffer()
    const noto = await Bun.file(
      new URL('../../../assets/NotoSansSC-Regular.ttf', import.meta.url)
    ).arrayBuffer()
    const previousFallbacks = [...fontManager.getCJKFallbackFamilies()]
    fontManager.attachProvider(ck, provider)
    fontManager.markLoaded('Inter', 'SemiBold', inter)
    fontManager.markLoaded('Noto Sans SC', 'Regular', noto)
    fontManager.setCJKFallbackFamily('Noto Sans SC')
    renderer.fontProvider = provider
    renderer.fontsLoaded = true
    const canvas = surface.getCanvas()
    const draw = spyOn(canvas, 'drawParagraph')
    const nativeBuild = renderer.buildParagraph.bind(renderer)
    const shaped: Array<{ text: string; missing: string[] }> = []
    const build = spyOn(renderer, 'buildParagraph').mockImplementation((label, color, options) => {
      const paragraph = nativeBuild(label, color, options)
      shaped.push({
        text: label.text,
        missing: missingGlyphCharacters(label.text, paragraph.getShapedLines())
      })
      return paragraph
    })
    try {
      for (const entry of expansionEntries()) {
        const graph = new SceneGraph()
        const page = expectDefined(graph.getPages()[0])
        const node = graph.createNode('FRAME', page.id, {
          ...createEffectPickModuleFrameOverrides({
            effectId: entry.id,
            text: '当前 Current',
            color: '#80e0c2',
            secondaryColor: '#fbbf24'
          }),
          width: 224,
          height: 101,
          textLanguage: 'zh-CN'
        })
        const projected = expectDefined(collectGraphFontRequirements(graph, [node.id]).nodes[0])
        expect(renderer.nodeFontReadiness(projected), entry.id).toBe('ready')
        const before = structuredClone([...graph.getAllNodes()])
        const previousDraws = draw.mock.calls.length
        canvas.clear(ck.TRANSPARENT)
        canvas.save()
        canvas.translate(RASTER_PADDING, RASTER_PADDING)
        try {
          expect(renderModulePreview(renderer, canvas, node, graph)).toBe(true)
        } finally {
          canvas.restore()
        }
        const pixels = readPixels(ck, surface, 256, 133)
        expect(inspectPixels(pixels, 256, node.width, node.height)).toMatchObject({ escaped: 0 })
        expect(
          inspectPixels(pixels, 256, node.width, node.height).painted,
          entry.id
        ).toBeGreaterThan(0)
        expect(renderer.pendingFontNodes.size, entry.id).toBe(0)
        expect(draw.mock.calls.length, entry.id).toBeGreaterThan(previousDraws)
        expect([...graph.getAllNodes()]).toEqual(before)
        graph.updateNode(node.id, {
          interactiveProps: createEffectPickModuleFrameOverrides({
            effectId: entry.id,
            text: '当前 Current',
            color: '#80e0c200',
            secondaryColor: '#fbbf2400'
          }).interactiveProps
        })
        canvas.clear(ck.TRANSPARENT)
        expect(renderModulePreview(renderer, canvas, node, graph)).toBe(true)
        expect(
          readPixels(ck, surface, 256, 133).every((value, index) => index % 4 !== 3 || value === 0),
          entry.id
        ).toBe(true)
      }
      expect(shaped.some(({ text }) => text.includes('当前 Current'))).toBe(true)
      expect(shaped.every(({ missing }) => missing.length === 0)).toBe(true)
    } finally {
      draw.mockRestore()
      build.mockRestore()
      fontManager.getCJKFallbackFamilies().splice(0, Infinity, ...previousFallbacks)
      renderer.destroy()
    }
  })

  test('preserves distinct primary and secondary colors in the expansion button gradient', async () => {
    const ck = await initCanvasKit()
    const surface = expectDefined(ck.MakeSurface(256, 133))
    const renderer = new SkiaRenderer(ck, surface)
    const canvas = surface.getCanvas()
    const graph = new SceneGraph()
    const page = expectDefined(graph.getPages()[0])
    const node = graph.createNode('FRAME', page.id, {
      ...createEffectPickModuleFrameOverrides({
        effectId: 'gradient-button',
        text: '',
        color: '#ff0000',
        secondaryColor: '#0000ff'
      }),
      width: 224,
      height: 101
    })
    try {
      expect(renderer.fontsLoaded).toBe(false)
      canvas.clear(ck.TRANSPARENT)
      expect(renderModulePreview(renderer, canvas, node, graph)).toBe(true)
      const pixels = readPixels(ck, surface, 256, 133)
      const left = (30 * 256 + 50) * 4
      const right = (70 * 256 + 174) * 4
      expect(pixels[left + 3]).toBeGreaterThan(0)
      expect(pixels[right + 3]).toBeGreaterThan(0)
      expect(pixels[left]).toBeGreaterThan(pixels[right])
      expect(pixels[left + 2]).toBeLessThan(pixels[right + 2])
    } finally {
      renderer.destroy()
    }
  })
})
