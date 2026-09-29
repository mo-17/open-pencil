import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { initCanvasKit } from '#cli/headless'
import { SkiaRenderer } from '#core/canvas/renderer'
import { recordRenderChunk, RenderChunkIndex } from '#core/canvas/renderer/chunks'
import {
  createDataGridModuleFrameOverrides,
  DATA_GRID_MODULE_DEFAULT_CONFIG
} from '#core/plugins/data-grid'
import { fontManager } from '#core/text/fonts'
import { collectGraphFontKeys, collectGraphFontRequirements } from '#core/text/requirements'
import { missingGlyphCharacters } from '#core/text/resolver'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

function fixture(fontSize = 20) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const node = graph.createNode('FRAME', pageId, {
    ...createDataGridModuleFrameOverrides({
      ...DATA_GRID_MODULE_DEFAULT_CONFIG,
      fontSize,
      data: {
        columns: [
          {
            id: 'name',
            label: '名称 Name',
            type: 'text',
            align: 'start',
            width: 280,
            sortable: true,
            filterable: true
          },
          {
            id: 'count',
            label: '数量',
            type: 'number',
            align: 'end',
            width: 120,
            sortable: true,
            filterable: false
          }
        ],
        rows: [
          { id: 'first', cells: ['中文 Alpha', 42] },
          { id: 'second', cells: ['第二条 Beta', null] },
          { id: 'third', cells: ['第三条', 73] }
        ]
      }
    }),
    width: 400,
    height: 220,
    textLanguage: 'zh-CN'
  })
  return { graph, node, pageId }
}

test('font preflight includes visible module headers, typed cells, and summary without adding graph children', () => {
  const { graph, node } = fixture()
  const before = structuredClone(node)
  const requirements = collectGraphFontRequirements(graph, [node.id])
  expect(requirements.scripts).toContain('cjk-sc')
  for (const character of '名称数量中文第二条三')
    expect(requirements.characters).toContain(character)
  expect(requirements.characters).toContain('4')
  expect(requirements.characters).toContain('—')
  expect(requirements.characters).toContain('·')
  expect(collectGraphFontKeys(graph, [node.id])).toContainEqual(['Inter', 'Regular'])
  expect(requirements.nodes[0]).toMatchObject({ id: node.id, type: 'TEXT', fontSize: 20 })
  expect(node).toEqual(before)
})

test('hidden rows and zero-area modules do not trigger unrelated font downloads', () => {
  const { graph, node } = fixture()
  graph.updateNode(node.id, { height: 40 })
  const requirements = collectGraphFontRequirements(graph, [node.id])
  expect(requirements.characters).toContain('名')
  expect(requirements.characters).not.toContain('第')
  graph.updateNode(node.id, { width: 0 })
  expect(collectGraphFontRequirements(graph, [node.id]).characters).toBe('')
})

test('real CanvasKit shapes Chinese and mixed DataGrid labels using the existing offline fallback', async () => {
  const { graph, node } = fixture()
  const ck = await initCanvasKit()
  const provider = ck.TypefaceFontProvider.Make()
  fontManager.attachProvider(ck, provider)
  const inter = await Bun.file(repoPath('packages/core/assets/Inter-Regular.ttf')).arrayBuffer()
  const noto = await Bun.file(repoPath('tests/fixtures/fonts/NotoSansSC-Regular.ttf')).arrayBuffer()
  const previousFallbacks = [...fontManager.getCJKFallbackFamilies()]
  fontManager.markLoaded('Inter', 'Regular', inter)
  fontManager.markLoaded('Noto Sans SC', 'Regular', noto)
  fontManager.setCJKFallbackFamily('Noto Sans SC')
  const surface = expectDefined(ck.MakeSurface(460, 270), 'DataGrid font surface')
  const renderer = new SkiaRenderer(ck, surface)
  const typeface = expectDefined(ck.Typeface.MakeFreeTypeFaceFromData(inter), 'DataGrid Inter')
  renderer.labelFont = new ck.Font(typeface, 11)
  renderer.fontProvider = provider
  renderer.fontsLoaded = true
  const canvas = surface.getCanvas()
  const nativeBuild = renderer.buildParagraph.bind(renderer)
  const shaped: Array<{ text: string; fontSize: number; missing: string[] }> = []
  const build = spyOn(renderer, 'buildParagraph').mockImplementation((label, color, options) => {
    const paragraph = nativeBuild(label, color, options)
    shaped.push({
      text: label.text,
      fontSize: label.fontSize,
      missing: missingGlyphCharacters(label.text, paragraph.getShapedLines())
    })
    return paragraph
  })
  const draw = spyOn(canvas, 'drawParagraph')
  const pixels = () => {
    const image = surface.makeImageSnapshot()
    try {
      return expectDefined(
        image.readPixels(0, 0, {
          width: 460,
          height: 270,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        }),
        'DataGrid pixels'
      )
    } finally {
      image.delete()
    }
  }
  try {
    expect(Array.from(renderer.labelFont.getGlyphIDs('名称中文'))).toContain(0)
    canvas.clear(ck.WHITE)
    canvas.save()
    canvas.translate(20, 20)
    renderer.renderShape(canvas, node, graph)
    canvas.restore()
    surface.flush()
    const snapshot = surface.makeImageSnapshot()
    try {
      const prefix = process.env.OPENPENCIL_DATA_GRID_EVIDENCE
      if (prefix) {
        await Bun.write(`${prefix}.png`, expectDefined(snapshot.encodeToBytes(), 'DataGrid image'))
        await Bun.write(
          `${prefix}.json`,
          JSON.stringify({ shaped, paragraphDraws: draw.mock.calls.length }, null, 2)
        )
      }
      const painted = pixels()
      let escapedInk = 0
      for (let y = 0; y < 270; y++)
        for (let x = 0; x < 460; x++) {
          if (x >= 20 && x < 420 && y >= 20 && y < 240) continue
          escapedInk += 255 - painted[(y * 460 + x) * 4]
        }
      expect(escapedInk).toBe(0)
    } finally {
      snapshot.delete()
    }
    expect(draw.mock.calls.length).toBe(9)
    expect(shaped.map(({ text }) => text)).toContain('名称 Name')
    expect(shaped.map(({ text }) => text)).toContain('中文 Alpha')
    expect(shaped.map(({ text }) => text)).toContain('3 rows · 0 filters · 20/page')
    expect(shaped.every(({ missing }) => missing.length === 0)).toBe(true)
    expect(shaped.find(({ text }) => text === '中文 Alpha')?.fontSize).toBe(20)
    expect(shaped.at(-1)?.fontSize).toBe(12)
    expect(renderer.labelFont.getSize()).toBe(11)
    expect(renderer.pendingFontNodes.size).toBe(0)
    expect(node.childIds).toEqual([])
    const direct = pixels()
    const { index } = RenderChunkIndex.build(graph, graph.getPages()[0].id)
    const chunk = expectDefined(
      index.search({ minX: 0, minY: 0, maxX: 460, maxY: 270 })[0],
      'DataGrid chunk'
    )
    const recorded = recordRenderChunk(renderer, graph, chunk)
    try {
      canvas.clear(ck.WHITE)
      canvas.save()
      canvas.translate(20, 20)
      canvas.drawPicture(recorded.picture)
      canvas.restore()
      surface.flush()
      expect(pixels()).toEqual(direct)
    } finally {
      recorded.picture.delete()
      index.dispose()
    }
    const changed = fixture(32).node.interactiveProps
    graph.updateNode(node.id, { interactiveProps: changed })
    renderer.invalidateNodePicture(node.id)
    canvas.clear(ck.WHITE)
    canvas.save()
    canvas.translate(20, 20)
    renderer.renderShape(canvas, node, graph)
    canvas.restore()
    expect(shaped.some(({ fontSize }) => fontSize === 32)).toBe(true)
    expect(pixels()).not.toEqual(direct)
    expect(renderer.labelFont.getSize()).toBe(11)
  } finally {
    draw.mockRestore()
    build.mockRestore()
    fontManager.getCJKFallbackFamilies().splice(0, Infinity, ...previousFallbacks)
    renderer.destroy()
    typeface.delete()
  }
})
