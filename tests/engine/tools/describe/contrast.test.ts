import { describe, expect, test } from 'bun:test'

import { type Fill, SceneGraph } from '@open-pencil/scene-graph'

import { colorToHex, parseColor } from '#core/color'
import { analyzeTextContrast } from '#core/tools/describe/contrast'
import { detectIssues } from '#core/tools/describe/issues'

function solid(hex: string, opacity = 1, colorAlpha = 1): Fill {
  return {
    type: 'SOLID',
    color: { ...parseColor(hex), a: colorAlpha },
    opacity,
    visible: true
  }
}

function frameWithText(background: string, foreground: string) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const frame = graph.createNode('FRAME', page.id, {
    name: 'Card',
    width: 320,
    height: 120,
    fills: [solid(background)]
  })
  const text = graph.createNode('TEXT', frame.id, {
    name: 'Label',
    text: 'Readable label',
    width: 200,
    height: 32,
    fills: [solid(foreground)]
  })
  return { frame, graph, text }
}

describe('describe text contrast', () => {
  test('does not report coral text on a near-black background as dark on dark', () => {
    const { frame, graph, text } = frameWithText('#0B0B0D', '#FF6B63')

    const contrast = analyzeTextContrast(text, graph)
    expect(contrast?.ratio).toBeGreaterThanOrEqual(4.5)
    expect(
      detectIssues(frame, 8, graph).some((issue) => /contrast|dark on dark/i.test(issue.message))
    ).toBe(false)
    expect(
      detectIssues(text, 8, graph).some((issue) => /contrast|dark on dark/i.test(issue.message))
    ).toBe(false)
  })

  test('reports the actual WCAG ratio and threshold for genuinely low contrast text', () => {
    const { graph, text } = frameWithText('#0B0B0D', '#202025')

    const contrastIssue = detectIssues(text, 8, graph).find((issue) =>
      issue.message.startsWith('Low contrast:')
    )
    expect(contrastIssue).toBeDefined()
    expect(contrastIssue?.severity).toBe('error')
    expect(contrastIssue?.message).toMatch(/\d+\.\d{2}:1 < 4\.50:1 \(WCAG AA\)/)
    expect(contrastIssue?.suggestion).toBe('Increase text contrast to ≥4.50:1')
  })

  test('composites translucent text and nested ancestor fills before measuring contrast', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const outer = graph.createNode('FRAME', page.id, {
      name: 'Opaque canvas',
      width: 320,
      height: 120,
      fills: [solid('#FFFFFF')]
    })
    const inner = graph.createNode('FRAME', outer.id, {
      name: 'Translucent panel',
      width: 300,
      height: 100,
      fills: [solid('#000000', 0.5, 0.5)]
    })
    const text = graph.createNode('TEXT', inner.id, {
      name: 'Translucent label',
      text: 'Alpha-aware',
      width: 200,
      height: 32,
      fills: [solid('#000000', 0.5)]
    })

    const contrast = analyzeTextContrast(text, graph)
    expect(contrast).not.toBeNull()
    if (!contrast) throw new Error('Expected resolved contrast')
    expect(colorToHex(contrast.background)).toBe('#BFBFBF')
    expect(colorToHex(contrast.foreground)).toBe('#606060')
    expect(contrast.ratio).toBeCloseTo(3.45, 2)

    const issue = detectIssues(text, 8, graph).find((candidate) =>
      candidate.message.startsWith('Low contrast:')
    )
    expect(issue?.message).toContain('#606060 on #BFBFBF')
    expect(issue?.message).toContain('3.45:1 < 4.50:1')
  })

  test('uses the WCAG AA 3:1 threshold only when all text is large', () => {
    const { graph, text } = frameWithText('#FFFFFF', '#808080')
    graph.updateNode(text.id, { fontSize: 40, fontWeight: 700 })
    const largeNode = graph.getNode(text.id)
    if (!largeNode) throw new Error('Expected large text node')

    const large = analyzeTextContrast(largeNode, graph)
    expect(large?.ratio).toBeGreaterThan(3)
    expect(large?.ratio).toBeLessThan(4.5)
    expect(large?.threshold).toBe(3)
    expect(detectIssues(largeNode, 8, graph)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/contrast/i) })
      ])
    )

    graph.updateNode(text.id, {
      styleRuns: [{ start: 0, length: 1, style: { fontSize: 12, fontWeight: 400 } }]
    })
    const mixedNode = graph.getNode(text.id)
    if (!mixedNode) throw new Error('Expected mixed-size text node')
    const mixed = analyzeTextContrast(mixedNode, graph)
    expect(mixed?.threshold).toBe(4.5)
    expect(detectIssues(mixedNode, 8, graph).some((issue) => /contrast/i.test(issue.message))).toBe(
      true
    )
  })

  test('uses an earlier, fully covering solid sibling as the text background', () => {
    const { frame, graph } = frameWithText('#FFFFFF', '#FFFFFF')
    const originalText = graph.getNode(frame.childIds[0])
    if (!originalText) throw new Error('Expected text node')
    graph.deleteNode(originalText.id)
    graph.createNode('RECTANGLE', frame.id, {
      name: 'Black plate',
      x: 20,
      y: 20,
      width: 240,
      height: 48,
      fills: [solid('#000000')]
    })
    const text = graph.createNode('TEXT', frame.id, {
      name: 'White label',
      text: 'Readable on the plate',
      x: 32,
      y: 28,
      width: 200,
      height: 32,
      fills: [solid('#FFFFFF')]
    })

    const contrast = analyzeTextContrast(text, graph)
    expect(colorToHex(contrast?.background ?? parseColor('#FF00FF'))).toBe('#000000')
    expect(contrast?.ratio).toBeCloseTo(21, 2)
    expect(detectIssues(text, 8, graph).some((issue) => /low contrast/i.test(issue.message))).toBe(
      false
    )
  })

  test('declines contrast when a sibling only partially overlaps or paints after the text', () => {
    const partial = frameWithText('#FFFFFF', '#FFFFFF')
    const partialPlate = partial.graph.createNode('RECTANGLE', partial.frame.id, {
      x: 0,
      y: 0,
      width: partial.text.width / 2,
      height: partial.text.height,
      fills: [solid('#000000')]
    })
    partial.graph.reorderChild(partialPlate.id, partial.frame.id, 0)
    expect(analyzeTextContrast(partial.text, partial.graph)).toBeNull()

    const later = frameWithText('#FFFFFF', '#FFFFFF')
    later.graph.createNode('RECTANGLE', later.frame.id, {
      x: 0,
      y: 0,
      width: later.text.width,
      height: later.text.height,
      fills: [solid('#000000')]
    })
    expect(analyzeTextContrast(later.text, later.graph)).toBeNull()
  })

  test('uses a full-span style-run fill instead of the unused base fill', () => {
    const { graph, text } = frameWithText('#FFFFFF', '#FFFFFF')
    graph.updateNode(text.id, {
      styleRuns: [{ start: 0, length: text.text.length, style: { fills: [solid('#000000')] } }]
    })
    const styled = graph.getNode(text.id)
    if (!styled) throw new Error('Expected styled text')

    const contrast = analyzeTextContrast(styled, graph)
    expect(colorToHex(contrast?.foreground ?? parseColor('#FF00FF'))).toBe('#000000')
    expect(contrast?.ratio).toBeCloseTo(21, 2)
    expect(
      detectIssues(styled, 8, graph).some((issue) => /low contrast/i.test(issue.message))
    ).toBe(false)
  })

  test('uses the first visible solid fill in a style run, matching CanvasKit text', () => {
    const { graph, text } = frameWithText('#FFFFFF', '#FFFFFF')
    graph.updateNode(text.id, {
      styleRuns: [
        {
          start: 0,
          length: text.text.length,
          style: { fills: [solid('#000000'), solid('#FFFFFF', 0.5)] }
        }
      ]
    })
    const styled = graph.getNode(text.id)
    if (!styled) throw new Error('Expected styled text')

    const contrast = analyzeTextContrast(styled, graph)
    expect(colorToHex(contrast?.foreground ?? parseColor('#FF00FF'))).toBe('#000000')
    expect(contrast?.ratio).toBeCloseTo(21, 2)
    expect(
      detectIssues(styled, 8, graph).some((issue) => /low contrast/i.test(issue.message))
    ).toBe(false)
  })

  test('declines nested contrast when an ancestor sibling may paint behind the branch', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('RECTANGLE', page.id, {
      width: 300,
      height: 100,
      fills: [solid('#000000')]
    })
    const transparentGroup = graph.createNode('FRAME', page.id, {
      width: 300,
      height: 100,
      fills: []
    })
    const text = graph.createNode('TEXT', transparentGroup.id, {
      text: 'Nested overlay',
      width: 200,
      height: 32,
      fills: [solid('#FFFFFF')]
    })

    expect(analyzeTextContrast(text, graph)).toBeNull()
  })

  test('reports the worst verifiable contrast across mixed style-run fills exactly once', () => {
    const { frame, graph, text } = frameWithText('#FFFFFF', '#000000')
    graph.updateNode(text.id, {
      styleRuns: [{ start: 0, length: 1, style: { fills: [solid('#FFFFFF')] } }]
    })
    const styled = graph.getNode(text.id)
    if (!styled) throw new Error('Expected mixed-style text')

    const contrast = analyzeTextContrast(styled, graph)
    expect(colorToHex(contrast?.foreground ?? parseColor('#FF00FF'))).toBe('#FFFFFF')
    expect(contrast?.ratio).toBeCloseTo(1, 2)
    expect(
      [...detectIssues(frame, 8, graph), ...detectIssues(styled, 8, graph)].filter((issue) =>
        issue.message.startsWith('Low contrast:')
      )
    ).toHaveLength(1)
  })
})
