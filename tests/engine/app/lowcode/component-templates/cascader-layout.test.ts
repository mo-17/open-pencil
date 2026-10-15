import { beforeAll, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { fontManager } from '@open-pencil/core/text'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { initCanvasKit } from '#cli/headless'

import { expectDefined } from '#tests/helpers/assert'
import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'
import { repoPath } from '#tests/helpers/paths'

let ck: Awaited<ReturnType<typeof initCanvasKit>>
beforeAll(async () => {
  ck = await initCanvasKit()
  await initCodec()
})

function expectCascaderTextFits(graph: SceneGraph, rootId: string, renderer: SkiaRenderer) {
  const root = expectDefined(graph.getNode(rootId), 'Cascader template root')
  const children = graph.getChildren(rootId)
  const description = expectDefined(children[1], 'Cascader description')
  const footer = expectDefined(children.at(-1), 'Cascader footer')
  expect(root.primaryAxisSizing).toBe('HUG')
  for (const text of [description, footer]) {
    const measured = expectDefined(renderer.measureTextNode(text, text.width), 'Canvas text size')
    expect(measured.height, text.text + ' wraps to multiple lines').toBeGreaterThan(
      expectDefined(text.lineHeight, 'Authored line height')
    )
    expect(text.height, text.text + ' fits its authored bounds').toBeGreaterThanOrEqual(
      measured.height
    )
    expect(text.textAutoResize).toBe('HEIGHT')
  }
  for (let index = 1; index < children.length; index++) {
    const previous = children[index - 1]
    expect(children[index].y, 'Actual sibling geometry preserves the gap').toBeGreaterThanOrEqual(
      previous.y + previous.height + root.itemSpacing
    )
  }
  expect(footer.y + footer.height + root.paddingBottom).toBeLessThanOrEqual(root.height)
}

test.each(['zh-CN', 'en'])(
  '%s Cascader text fits Canvas bounds after insert, redo and FIG readback',
  async (locale) => {
    const { editor, graph, results } = componentTemplateFixture(['cascader'], locale)
    const rootId = results[0].rootId
    const surface = expectDefined(ck.MakeSurface(1, 1), 'Canvas text measurement surface')
    const renderer = new SkiaRenderer(ck, surface)
    const provider = ck.TypefaceFontProvider.Make()
    const previousFallbacks = [...fontManager.getCJKFallbackFamilies()]
    try {
      fontManager.attachProvider(ck, provider)
      for (const [family, path] of [
        ['Inter', 'packages/core/assets/Inter-Regular.ttf'],
        ['Noto Sans SC', 'tests/fixtures/fonts/NotoSansSC-Regular.ttf']
      ]) {
        const data = new Uint8Array(readFileSync(repoPath(path)))
        fontManager.markLoaded(family, 'Regular', data.buffer)
      }
      fontManager.setCJKFallbackFamily('Noto Sans SC')
      renderer.fontProvider = provider
      renderer.fontsLoaded = true
      expectCascaderTextFits(graph, rootId, renderer)
      editor.undo.undo()
      expect(graph.getNode(rootId)).toBeUndefined()
      editor.undo.redo()
      expectCascaderTextFits(graph, rootId, renderer)
      const imported = await parseFigFile((await exportFigFile(graph)).slice().buffer)
      const importedRoot = expectDefined(imported.getChildren(imported.getPages()[0].id)[0])
      expectCascaderTextFits(imported, importedRoot.id, renderer)
    } finally {
      fontManager.getCJKFallbackFamilies().splice(0, Infinity, ...previousFallbacks)
      renderer.destroy()
      editor.dispose()
    }
  }
)
