import { beforeAll, describe, expect, test } from 'bun:test'

import { parseFigBuffer } from '@open-pencil/fig'
import { SceneGraph } from '@open-pencil/scene-graph'

import { exportFigFileWithOptions } from '#core/io/formats/fig/export'
import { FIGMA_CJK_PROJECTION_FONT } from '#core/io/formats/fig/projection-fonts'
import { fontManager } from '#core/text/fonts'

const LABEL = '整理行囊'
const LATIN_ONLY_FAMILY = 'ArchiveLatinOnly'

describe('Figma-compatible CJK derived glyphs', () => {
  beforeAll(async () => {
    const bytes = await Bun.file('tests/fixtures/fonts/NotoNaskhArabic-Regular.ttf').arrayBuffer()
    fontManager.markLoaded(LATIN_ONLY_FAMILY, 'Regular', bytes)
  })

  test('bakes bundled Noto Sans SC outlines when the requested face lacks CJK', async () => {
    const graph = new SceneGraph()
    graph.createNode('BUTTON', graph.getPages()[0].id, {
      name: 'CJK fallback button',
      width: 180,
      height: 44,
      fontFamily: LATIN_ONLY_FAMILY,
      fontWeight: 400,
      interactiveProps: { text: LABEL }
    })

    const bytes = await exportFigFileWithOptions(graph, { profile: 'figma-compatible' })
    const parsed = parseFigBuffer(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    )
    const label = parsed.nodeChanges.find(
      (change) => change.type === 'TEXT' && change.textData?.characters === LABEL
    )
    const glyphs = label?.derivedTextData?.glyphs ?? []

    expect(label?.fontName?.family).toBe(FIGMA_CJK_PROJECTION_FONT)
    expect(label?.derivedTextData?.fontMetaData?.[0]?.key.family).toBe(FIGMA_CJK_PROJECTION_FONT)
    expect(glyphs).toHaveLength(Array.from(LABEL).length)
    for (const glyph of glyphs) {
      expect(glyph.commandsBlob).toBeDefined()
      expect(parsed.blobs[glyph.commandsBlob ?? -1]?.byteLength).toBeGreaterThan(0)
    }
  })
})
