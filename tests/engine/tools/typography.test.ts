import { describe, expect, test } from 'bun:test'

import { getTool, setupToolTest } from '#tests/helpers/tools'

interface TypographyResult {
  totalTextNodes: number
  uniqueStyles?: number
  styles?: Array<{
    family: string
    size: number
    weight: number
    lineHeight: string
    count: number
  }>
  groups?: Array<{ family: string; count: number }>
}

describe('analyze_typography', () => {
  test('counts visible INPUT and TEXTAREA text with their authored typography', () => {
    const { graph, figma } = setupToolTest()
    const sharedFamily = 'OpenPencil Form Typography'
    const textareaFamily = 'OpenPencil Textarea Typography'
    graph.createNode('TEXT', figma.currentPageId, {
      text: 'Form title',
      fontFamily: sharedFamily,
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 24
    })
    graph.createNode('INPUT', figma.currentPageId, {
      fontFamily: sharedFamily,
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 24,
      interactiveProps: { placeholder: 'Email address', value: '' }
    })
    graph.createNode('TEXTAREA', figma.currentPageId, {
      fontFamily: textareaFamily,
      fontSize: 14,
      fontWeight: 700,
      interactiveProps: { placeholder: 'Notes', value: 'Saved note' }
    })
    graph.createNode('RECTANGLE', figma.currentPageId, { name: 'Ignored' })

    const result = getTool('analyze_typography').execute(figma, {}) as TypographyResult
    const byFamily = getTool('analyze_typography').execute(figma, {
      group_by: 'family'
    }) as TypographyResult

    expect(result).toEqual({
      totalTextNodes: 3,
      uniqueStyles: 2,
      styles: [
        {
          family: sharedFamily,
          size: 16,
          weight: 400,
          lineHeight: '24',
          count: 2
        },
        {
          family: textareaFamily,
          size: 14,
          weight: 700,
          lineHeight: 'auto',
          count: 1
        }
      ]
    })
    expect(byFamily).toEqual({
      totalTextNodes: 3,
      groups: [
        { family: sharedFamily, count: 2 },
        { family: textareaFamily, count: 1 }
      ]
    })
  })
})
