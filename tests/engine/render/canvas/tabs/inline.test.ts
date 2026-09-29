import { expect, spyOn, test } from 'bun:test'

import type { LineMetrics } from 'canvaskit-wasm'

import { SceneGraph } from '@open-pencil/scene-graph'

import { initCanvasKit } from '#cli/headless'
import { renderTabsModulePreview } from '#core/canvas/modules/tabs'
import { SkiaRenderer } from '#core/canvas/renderer'
import { tabsPreviewGeometry } from '#core/plugins/content/tabs'
import { createTabsModuleFrameOverrides, resolveTabsModule } from '#core/plugins/tabs'
import { fontManager } from '#core/text/fonts'
import { missingGlyphCharacters } from '#core/text/resolver'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

const FIRST_CONTENT =
  '第一行 First line\n第二行 Mixed 中文内容，需要按正文宽度自动换行并保留文本。\n第三行 Final line'
const SECOND_CONTENT = '另一个标签\nSecond panel'

test('Tabs inline panels preserve multiline CJK text, wrap within their viewport, and follow a transient active tab', async () => {
  const ck = await initCanvasKit()
  const surface = expectDefined(ck.MakeSurface(360, 360), 'Tabs inline surface')
  const renderer = new SkiaRenderer(ck, surface)
  const provider = ck.TypefaceFontProvider.Make()
  const previousFallbacks = [...fontManager.getCJKFallbackFamilies()]
  const regular = await Bun.file(repoPath('packages/core/assets/Inter-Regular.ttf')).arrayBuffer()
  const semibold = await Bun.file(repoPath('packages/core/assets/Inter-SemiBold.ttf')).arrayBuffer()
  const cjk = await Bun.file(repoPath('tests/fixtures/fonts/NotoSansSC-Regular.ttf')).arrayBuffer()
  fontManager.attachProvider(ck, provider)
  fontManager.markLoaded('Inter', 'Regular', regular)
  fontManager.markLoaded('Inter', 'SemiBold', semibold)
  fontManager.markLoaded('Noto Sans SC', 'Regular', cjk)
  fontManager.setCJKFallbackFamily('Noto Sans SC')
  const typeface = expectDefined(ck.Typeface.MakeFreeTypeFaceFromData(regular), 'Tabs inline Inter')
  renderer.labelFont = new ck.Font(typeface, 11)
  renderer.fontProvider = provider
  renderer.fontsLoaded = true
  const canvas = surface.getCanvas()
  const shaped: Array<{
    text: string
    weight: number
    lineHeight: number | null
    lines: LineMetrics[]
    height: number
    missing: string[]
  }> = []
  const nativeBuild = renderer.buildParagraph.bind(renderer)
  const build = spyOn(renderer, 'buildParagraph').mockImplementation((node, color, options) => {
    const paragraph = nativeBuild(node, color, options)
    shaped.push({
      text: node.text,
      weight: node.fontWeight,
      lineHeight: node.lineHeight,
      lines: paragraph.getLineMetrics(),
      height: paragraph.getHeight(),
      missing: missingGlyphCharacters(node.text, paragraph.getShapedLines())
    })
    return paragraph
  })
  const pixels = () => {
    const image = surface.makeImageSnapshot()
    try {
      return expectDefined(
        image.readPixels(0, 0, {
          width: 360,
          height: 360,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        }),
        'Tabs inline pixels'
      )
    } finally {
      image.delete()
    }
  }
  const ink = (data: Uint8Array | Float32Array, x: number, y: number) =>
    765 - data[(y * 360 + x) * 4] - data[(y * 360 + x) * 4 + 1] - data[(y * 360 + x) * 4 + 2]
  const save = async (suffix: string) => {
    const prefix = process.env.OPENPENCIL_TABS_INLINE_EVIDENCE
    if (!prefix) return
    const image = surface.makeImageSnapshot()
    try {
      await Bun.write(
        `${prefix}-${suffix}.png`,
        expectDefined(image.encodeToBytes(), 'Tabs inline PNG')
      )
    } finally {
      image.delete()
    }
  }
  try {
    const graph = new SceneGraph()
    const node = graph.createNode('FRAME', graph.getPages()[0].id, {
      ...createTabsModuleFrameOverrides({
        tabs: [
          { id: 'one', label: '概览', content: FIRST_CONTENT },
          { id: 'two', label: '详情', content: SECOND_CONTENT }
        ],
        initialTabId: 'one'
      }),
      width: 320,
      height: 260,
      textLanguage: 'zh-CN',
      strokes: []
    })
    const resolved = resolveTabsModule(node.interactiveProps?.module)
    if (!resolved?.ok) throw new Error('Invalid Tabs fixture')
    const config = resolved.config
    const original = structuredClone(node)
    canvas.clear(ck.WHITE)
    renderTabsModulePreview(renderer, canvas, node)
    await save('multiline')
    const body = expectDefined(
      shaped.find((entry) => entry.text === FIRST_CONTENT),
      'Tabs body paragraph'
    )
    expect(body.weight).toBe(400)
    expect(body.lines.length).toBeGreaterThanOrEqual(4)
    expect(body.lineHeight).toBe(config.fontSize * 1.6)
    expect(body.missing).toEqual([])
    expect(body.lines.filter((line) => line.isHardBreak).length).toBeGreaterThanOrEqual(2)
    const { content } = tabsPreviewGeometry(node, config)
    const data = pixels()
    for (const line of body.lines) {
      let lineInk = 0
      const top = Math.floor(content.y + line.baseline - line.ascent)
      const bottom = Math.ceil(content.y + line.baseline + line.descent)
      for (let y = top; y < bottom; y++)
        for (let x = content.x; x < content.x + content.width; x++) lineInk += ink(data, x, y)
      expect(lineInk).toBeGreaterThan(100)
    }

    // A temporary preview switches both label and inline panel without writing the module config.
    const preview = {
      ...node,
      interactiveProps: createTabsModuleFrameOverrides({ ...config, initialTabId: 'two' })
        .interactiveProps
    }
    shaped.length = 0
    canvas.clear(ck.WHITE)
    renderTabsModulePreview(renderer, canvas, preview)
    await save('second-panel')
    expect(shaped.map((entry) => entry.text)).toContain(SECOND_CONTENT)
    expect(shaped.map((entry) => entry.text)).not.toContain(FIRST_CONTENT)
    expect(shaped.find((entry) => entry.text === SECOND_CONTENT)?.lines).toHaveLength(2)
    expect(node).toEqual(original)

    for (const orientation of ['horizontal', 'vertical'] as const) {
      const small = {
        ...node,
        width: orientation === 'horizontal' ? 96 : 160,
        height: 140,
        interactiveProps: createTabsModuleFrameOverrides({ ...config, orientation })
          .interactiveProps
      }
      const geometry = tabsPreviewGeometry(small, { ...config, orientation })
      const bounds = geometry.content
      shaped.length = 0
      canvas.clear(ck.WHITE)
      renderTabsModulePreview(renderer, canvas, small)
      await save(`${orientation}-clipped`)
      const wrapped = expectDefined(
        shaped.find((entry) => entry.text === FIRST_CONTENT),
        'Narrow Tabs body'
      )
      expect(wrapped.lines.length).toBeGreaterThan(body.lines.length)
      expect(wrapped.height).toBeGreaterThan(bounds.height)
      expect(wrapped.missing).toEqual([])
      const clipped = pixels()
      let visibleInk = 0
      let escapedInk = 0
      for (let y = Math.ceil(geometry.body.y); y < 360; y++)
        for (let x = Math.ceil(geometry.body.x); x < 360; x++) {
          // Fractional viewport edges may cover part of an antialiased pixel.
          const inside =
            x >= Math.floor(bounds.x) &&
            y >= Math.floor(bounds.y) &&
            x < Math.ceil(bounds.x + bounds.width) &&
            y < Math.ceil(bounds.y + bounds.height)
          if (inside) visibleInk += ink(clipped, x, y)
          else escapedInk += ink(clipped, x, y)
        }
      expect(visibleInk).toBeGreaterThan(100)
      expect(escapedInk).toBe(0)
    }
  } finally {
    build.mockRestore()
    fontManager.getCJKFallbackFamilies().splice(0, Infinity, ...previousFallbacks)
    renderer.destroy()
    typeface.delete()
  }
})
