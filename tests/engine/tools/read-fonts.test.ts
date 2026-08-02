import { describe, expect, test } from 'bun:test'

import type { FigmaAPI } from '@open-pencil/core'

import { fontManager } from '#core/text/fonts'
import { fontFaceDemand, fontResolver } from '#core/text/resolver'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type Readiness = 'ready' | 'pending' | 'exhausted'

interface FontCheckResult {
  error?: string
  assignment?: string
  status?: string
  renderStatus?: string
  readiness?: string
  effective?: boolean | null
  exactFacesLoaded?: boolean
  faces?: Array<{
    family: string
    style: string
    mode: string
    exactLoaded: boolean
    familyLoaded: boolean
    scopes: Array<{ kind: string; start?: number; end?: number }>
    resolution: { state: string; source?: string }
  }>
  caveats?: string[]
}

function attachReadiness(figma: FigmaAPI, readiness: Readiness): void {
  figma.getNodeFontReadiness = () => readiness
}

describe('check_font', () => {
  test('reports an exact loaded face as effective', () => {
    const { graph, figma } = setupToolTest()
    const family = 'OpenPencil Check Font Exact'
    const node = graph.createNode('TEXT', figma.currentPageId, {
      name: 'Exact font',
      text: 'Hello',
      fontFamily: family,
      fontWeight: 400
    })
    fontManager.markLoaded(family, 'Regular', new ArrayBuffer(1))
    attachReadiness(figma, 'ready')

    const result = getTool('check_font').execute(figma, {
      id: node.id,
      expected_family: family,
      expected_style: 'Regular'
    }) as FontCheckResult

    expect(result.assignment).toBe('match')
    expect(result.status).toBe('effective')
    expect(result.effective).toBe(true)
    expect(result.exactFacesLoaded).toBe(true)
    expect(result.faces?.[0]).toMatchObject({
      family,
      style: 'Regular',
      mode: 'exact',
      exactLoaded: true,
      familyLoaded: true,
      resolution: { state: 'loaded', source: 'registered' }
    })
  })

  test('reports mixed style-run assignments instead of trusting only the base font', () => {
    const { graph, figma } = setupToolTest()
    const baseFamily = 'OpenPencil Check Font Base'
    const rangeFamily = 'OpenPencil Check Font Range'
    const node = graph.createNode('TEXT', figma.currentPageId, {
      name: 'Mixed font',
      text: 'HelloWorld',
      fontFamily: baseFamily,
      fontWeight: 400,
      styleRuns: [
        {
          start: 5,
          length: 5,
          style: { fontFamily: rangeFamily, fontWeight: 700 }
        }
      ]
    })
    fontManager.markLoaded(baseFamily, 'Regular', new ArrayBuffer(1))
    fontManager.markLoaded(rangeFamily, 'Bold', new ArrayBuffer(1))
    attachReadiness(figma, 'ready')

    const result = getTool('check_font').execute(figma, {
      id: node.id,
      expected_family: baseFamily
    }) as FontCheckResult

    expect(result.assignment).toBe('partial')
    expect(result.status).toBe('mismatch')
    expect(result.renderStatus).toBe('effective')
    expect(result.effective).toBe(false)
    expect(result.faces).toHaveLength(2)
    expect(result.faces?.[1]).toMatchObject({
      family: rangeFamily,
      style: 'Bold',
      scopes: [{ kind: 'style_run', start: 5, end: 10 }]
    })
  })

  test('keeps pending resolution unknown and asks the caller to retry', () => {
    const { graph, figma } = setupToolTest()
    const family = 'OpenPencil Check Font Pending'
    const node = graph.createNode('TEXT', figma.currentPageId, {
      text: 'Loading',
      fontFamily: family
    })
    attachReadiness(figma, 'pending')

    const result = getTool('check_font').execute(figma, {
      id: node.id,
      expected_family: family
    }) as FontCheckResult

    expect(result.status).toBe('pending')
    expect(result.effective).toBeNull()
    expect(result.faces?.[0]?.mode).toBe('pending')
    expect(result.caveats?.join(' ')).toContain('call check_font again')
  })

  test('distinguishes a synthesized style from an exact loaded face', () => {
    const { graph, figma } = setupToolTest()
    const family = 'OpenPencil Check Font Synthesized'
    const node = graph.createNode('TEXT', figma.currentPageId, {
      text: 'Synthetic bold',
      fontFamily: family,
      fontWeight: 700
    })
    fontManager.markLoaded(family, 'Regular', new ArrayBuffer(1))
    attachReadiness(figma, 'ready')

    const result = getTool('check_font').execute(figma, {
      id: node.id,
      expected_family: family,
      expected_style: 'Bold'
    }) as FontCheckResult

    expect(result.status).toBe('degraded')
    expect(result.effective).toBe(true)
    expect(result.exactFacesLoaded).toBe(false)
    expect(result.faces?.[0]).toMatchObject({
      style: 'Bold',
      mode: 'synthesized',
      exactLoaded: false,
      familyLoaded: true
    })
  })

  test('reports exhausted resolution as ineffective', () => {
    const { graph, figma } = setupToolTest()
    const family = 'OpenPencil Check Font Exhausted'
    const node = graph.createNode('TEXT', figma.currentPageId, {
      text: 'Missing',
      fontFamily: family
    })
    const demand = fontFaceDemand(family, 'Regular', node.text)
    fontResolver.exhaust(demand)
    attachReadiness(figma, 'exhausted')

    try {
      const result = getTool('check_font').execute(figma, {
        id: node.id,
        expected_family: family
      }) as FontCheckResult

      expect(result.status).toBe('exhausted')
      expect(result.effective).toBe(false)
      expect(result.faces?.[0]?.resolution.state).toBe('exhausted')
    } finally {
      fontResolver.reset(demand)
    }
  })

  test('does not claim success without a live renderer and validates node type', () => {
    const { graph, figma } = setupToolTest()
    const text = graph.createNode('TEXT', figma.currentPageId, {
      text: 'No renderer',
      fontFamily: 'OpenPencil Check Font Unverifiable'
    })
    const rectangle = graph.createNode('RECTANGLE', figma.currentPageId)
    const tool = getTool('check_font')

    const result = tool.execute(figma, { id: text.id }) as FontCheckResult
    const wrongType = tool.execute(figma, { id: rectangle.id }) as FontCheckResult
    const missing = tool.execute(figma, { id: 'missing-font-node' }) as FontCheckResult

    expect(result.status).toBe('unverifiable')
    expect(result.effective).toBeNull()
    expect(result.caveats?.join(' ')).toContain('No live CanvasKit renderer')
    expect(wrongType.error).toContain('is not a text node')
    expect(missing.error).toContain('not found')
  })

  test('does not claim success while an attached renderer font provider is still initializing', () => {
    const { graph, figma } = setupToolTest()
    const family = 'OpenPencil Check Font Initializing Renderer'
    const node = graph.createNode('TEXT', figma.currentPageId, {
      text: 'Initializing',
      fontFamily: family
    })
    fontManager.markLoaded(family, 'Regular', new ArrayBuffer(1))
    figma.setRenderer({
      canObserveFontReadiness: () => false,
      nodeFontReadiness: () => 'ready'
    } as never)

    const result = getTool('check_font').execute(figma, { id: node.id }) as FontCheckResult

    expect(result.status).toBe('unverifiable')
    expect(result.effective).toBeNull()
    expect(result.exactFacesLoaded).toBe(true)
  })

  test('checks a lowcode BUTTON label through the renderer text projection', () => {
    const { graph, figma } = setupToolTest()
    const family = 'OpenPencil Check Font Button'
    const button = graph.createNode('BUTTON', figma.currentPageId, {
      name: 'Projected label',
      fontFamily: family,
      interactiveProps: { text: 'Continue' }
    })
    fontManager.markLoaded(family, 'Regular', new ArrayBuffer(1))
    attachReadiness(figma, 'ready')

    const result = getTool('check_font').execute(figma, { id: button.id }) as FontCheckResult & {
      nodeType?: string
      contentKind?: string
    }

    expect(result.status).toBe('effective')
    expect(result.nodeType).toBe('BUTTON')
    expect(result.contentKind).toBe('button_label')
  })
})
