import { describe, expect, test } from 'bun:test'

import { exportFigFile, parseFigFile, SceneGraph } from '@open-pencil/core'
import { fontManager } from '@open-pencil/core/text'

import { expectDefined } from '#tests/helpers/assert'

import { pageId } from '../helpers'

/**
 * Regression: text whose font lacks a glyph for some characters (e.g. CJK in a
 * Latin-only font) must NOT bake `.notdef` box outlines into derivedTextData.
 * Before the fix, the export baked one notdef box per uncovered character; on
 * reopen those baked glyphs were drawn verbatim (drawFigmaDerivedText) instead
 * of live-shaping with script-aware fallback, so Chinese rendered as tofu/乱码.
 * The fix skips the bake when the font does not cover the whole string, leaving
 * the reopened node to live-shape. Fonts the text DOES cover still bake.
 */
const CN = '你好世界'

// Arabic font stands in for any Latin-only font (Inter etc.) — it has no CJK
// glyphs, so 你好世界 maps entirely to `.notdef`.
const arabicBytes = await Bun.file('tests/fixtures/fonts/NotoNaskhArabic-Regular.ttf').arrayBuffer()
const scBytes = await Bun.file('tests/fixtures/fonts/NotoSansSC-Regular.ttf').arrayBuffer()

fontManager.markLoaded('CoverageLatin', 'Regular', arabicBytes)
fontManager.markLoaded('CoverageCJK', 'Regular', scBytes)

async function roundTrip(family: string) {
  const graph = new SceneGraph()
  graph.createNode('TEXT', pageId(graph), {
    name: 'CN',
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    text: CN,
    fontFamily: family,
    fontWeight: 400,
    fontSize: 24
  })
  const bytes = await exportFigFile(graph)
  const reopened = await parseFigFile(bytes.buffer as ArrayBuffer)
  return expectDefined(
    [...reopened.nodes.values()].find((n) => n.type === 'TEXT'),
    'reopened text node'
  )
}

describe('derivedTextData glyph coverage', () => {
  test('font lacking CJK glyphs bakes NO derived glyphs (renders via live shaping)', async () => {
    const node = await roundTrip('CoverageLatin')
    expect(node.text).toBe(CN)
    expect(node.figmaDerivedTextGlyphs ?? []).toHaveLength(0)
  })

  test('font covering the text still bakes derived glyphs (no regression)', async () => {
    const node = await roundTrip('CoverageCJK')
    expect(node.text).toBe(CN)
    expect((node.figmaDerivedTextGlyphs ?? []).length).toBeGreaterThan(0)
  })
})
