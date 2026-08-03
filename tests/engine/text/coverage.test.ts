import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'
import {
  collectGraphFontKeys,
  collectGraphFontRequirements,
  fontManager,
  missingGraphFontScripts,
  textNeededFallbackScripts
} from '@open-pencil/core/text'

function pageId(graph: SceneGraph): string {
  return graph.getPages()[0].id
}

describe('font fallback coverage indexing', () => {
  test('collects glyphs after applying visual text case', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('TEXT', pageId(graph), { text: 'abc', textCase: 'UPPER' })
    expect(collectGraphFontRequirements(graph, [node.id]).characters).toBe('ABC')
  })

  test('includes a lowcode BUTTON label in font and fallback preflight', async () => {
    const family = `ButtonLatin_${Date.now()}`
    const data = await Bun.file('public/Inter-Regular.ttf').arrayBuffer()
    fontManager.markLoaded(family, 'Regular', data)
    const graph = new SceneGraph()
    const node = graph.createNode('BUTTON', pageId(graph), {
      fontFamily: family,
      fontWeight: 400,
      interactiveProps: { text: '整理行囊' }
    })

    const requirements = collectGraphFontRequirements(graph, [node.id])

    expect(requirements.characters).toBe('整理行囊')
    expect(requirements.nodes).toHaveLength(1)
    expect(requirements.nodes[0]).toMatchObject({ id: node.id, type: 'TEXT', text: '整理行囊' })
    expect(missingGraphFontScripts(requirements)).toContain('cjk-sc')
  })

  test('includes INPUT placeholders and TEXTAREA values in font and fallback preflight', async () => {
    const data = await Bun.file('public/Inter-Regular.ttf').arrayBuffer()
    const inputFamily = `InputPlaceholderLatin_${Date.now()}`
    const textareaFamily = `TextareaValueLatin_${Date.now()}`
    fontManager.markLoaded(inputFamily, 'Regular', data)
    fontManager.markLoaded(textareaFamily, 'Bold', data)
    const graph = new SceneGraph()
    const input = graph.createNode('INPUT', pageId(graph), {
      fontFamily: inputFamily,
      fontWeight: 400,
      textLanguage: 'zh-CN',
      interactiveProps: { placeholder: '请输入姓名', value: '' }
    })
    const textarea = graph.createNode('TEXTAREA', pageId(graph), {
      fontFamily: textareaFamily,
      fontWeight: 700,
      textLanguage: 'zh-Hant-TW',
      interactiveProps: { placeholder: 'Ignored', value: '備註' }
    })

    const requirements = collectGraphFontRequirements(graph, [input.id, textarea.id])

    expect(requirements.characters).toBe('请输入姓名備註')
    expect(requirements.nodes.map((node) => [node.id, node.type, node.text])).toEqual([
      [input.id, 'TEXT', '请输入姓名'],
      [textarea.id, 'TEXT', '備註']
    ])
    expect(requirements.scripts).toEqual(['cjk-sc', 'cjk-tc'])
    expect(missingGraphFontScripts(requirements)).toEqual(['cjk-sc', 'cjk-tc'])
    expect(collectGraphFontKeys(graph, [input.id, textarea.id])).toEqual([
      [inputFamily, 'Regular'],
      [textareaFamily, 'Bold']
    ])
  })

  test('detects supplementary-plane Han code points', async () => {
    const family = `SupplementaryHan_${Date.now()}`
    const data = await Bun.file('public/Inter-Regular.ttf').arrayBuffer()
    fontManager.markLoaded(family, 'Regular', data)
    const graph = new SceneGraph()
    const node = graph.createNode('TEXT', pageId(graph), {
      text: 'A𠀀B',
      fontFamily: family,
      fontWeight: 400
    })

    expect(textNeededFallbackScripts(node)).toContain('cjk-sc')
  })

  test('uses BCP-47 language hints for Han fallback selection', async () => {
    const family = `LanguageHint_${Date.now()}`
    const data = await Bun.file('public/Inter-Regular.ttf').arrayBuffer()
    fontManager.markLoaded(family, 'Regular', data)
    const graph = new SceneGraph()
    const node = graph.createNode('TEXT', pageId(graph), {
      text: '骨骨',
      textLanguage: 'ja-JP',
      fontFamily: family,
      fontWeight: 400,
      styleRuns: [
        {
          start: 1,
          length: 1,
          style: { textLanguage: 'zh-Hant-TW' }
        }
      ]
    })

    expect(textNeededFallbackScripts(node)).toEqual(['cjk-jp', 'cjk-tc'])
  })

  test('uses UTF-16 style-run indices after a surrogate pair', async () => {
    const cjkData = await Bun.file('tests/fixtures/fonts/NotoSansSC-Regular.ttf').arrayBuffer()
    const latinData = await Bun.file('public/Inter-Regular.ttf').arrayBuffer()
    const cjkFamily = `CJKRunBase_${Date.now()}`
    const latinFamily = `CJKRunOverride_${Date.now()}`
    fontManager.markLoaded(cjkFamily, 'Regular', cjkData)
    fontManager.markLoaded(latinFamily, 'Regular', latinData)
    const graph = new SceneGraph()
    const node = graph.createNode('TEXT', pageId(graph), {
      text: '😀你',
      fontFamily: cjkFamily,
      fontWeight: 400,
      styleRuns: [
        {
          start: 2,
          length: 1,
          style: { fontFamily: latinFamily }
        }
      ]
    })

    expect(textNeededFallbackScripts(node)).toContain('cjk-sc')
  })
})
