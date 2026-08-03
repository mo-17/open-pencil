import { describe, expect, test } from 'bun:test'

import type { FigmaAPI } from '@open-pencil/core'

import { fontManager } from '#core/text/fonts'

import { getTool, setupToolTest } from '#tests/helpers/tools'

interface FontAuditResult {
  error?: string
  summary?: {
    complete: boolean
    matchedTextControls: number
    matchedTextAndButtonLabels: number
    auditedNodes: number
    returnedNodes: number
    omittedNodes: number
    knownUnauditedNodes: number
    ready: number
    degraded: number
    pending: number
    notReady: number
    unverifiable: number
  }
  retry?: {
    requested: boolean
    status: string
    complete: boolean
    auditedStatus?: string
    attempts: number
    timeoutMs: number
    reason?: string
  }
  license?: {
    status: string
    renderabilityIsLicenseEvidence: boolean
    suggestedTool: string
  }
  nodes?: Array<{
    id: string
    nodeType: string
    contentKind: string
    textPreview: string
    renderReady: string
    exactFacesLoaded: boolean
    requestedFaces: Array<{ family: string; style: string }>
    actualFaces: Array<{
      mode: string
      loadedFamily: string | null
      loadedStyle: string | null
    }>
    glyphFallback: { family: string | null; observation: string }
  }>
}

function attachReadiness(
  figma: FigmaAPI,
  readiness: (id: string) => 'ready' | 'pending' | 'exhausted'
): void {
  figma.getNodeFontReadiness = readiness
  figma.retryNodeFontReadiness = (id) => ({ requested: true, demandKeys: [`test:${id}`] })
}

describe('audit_font_rendering', () => {
  test('audits TEXT and visible lowcode control text without treating it as license evidence', async () => {
    const { figma, graph } = setupToolTest()
    const page = graph.getPages()[0]
    graph.createNode('TEXT', page.id, { name: 'Heading', text: 'Hello', fontFamily: 'Audit A' })
    graph.createNode('BUTTON', page.id, {
      name: 'CTA',
      fontFamily: 'Audit Button',
      interactiveProps: { text: 'Continue' }
    })
    graph.createNode('INPUT', page.id, {
      name: 'Email',
      fontFamily: 'Audit Input',
      interactiveProps: { placeholder: 'Email address', value: '' }
    })
    graph.createNode('TEXTAREA', page.id, {
      name: 'Notes',
      fontFamily: 'Audit Textarea',
      interactiveProps: { placeholder: 'Ignored placeholder', value: 'Saved note' }
    })
    graph.createNode('RECTANGLE', page.id, { name: 'Ignored' })

    const result = (await getTool('audit_font_rendering').execute(figma, {})) as FontAuditResult

    expect(result.summary).toMatchObject({
      matchedTextControls: 4,
      matchedTextAndButtonLabels: 4,
      returnedNodes: 4,
      omittedNodes: 0,
      unverifiable: 4
    })
    expect(
      result.nodes?.map((node) => [node.nodeType, node.contentKind, node.textPreview])
    ).toEqual([
      ['TEXT', 'text', 'Hello'],
      ['BUTTON', 'button_label', 'Continue'],
      ['INPUT', 'input_placeholder', 'Email address'],
      ['TEXTAREA', 'textarea_value', 'Saved note']
    ])
    expect(result.nodes?.every((node) => node.renderReady === 'unverifiable')).toBe(true)
    expect(result.nodes?.every((node) => node.glyphFallback.family === null)).toBe(true)
    expect(result.license).toEqual({
      status: 'not_assessed',
      renderabilityIsLicenseEvidence: false,
      suggestedTool: 'audit_font_licenses'
    })
  })

  test('supports ids/subtree scope and bounded result truncation', async () => {
    const { figma, graph } = setupToolTest()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, { name: 'Scoped frame' })
    graph.createNode('TEXT', frame.id, { text: 'One' })
    graph.createNode('BUTTON', frame.id, { interactiveProps: { text: 'Two' } })
    graph.createNode('TEXT', page.id, { text: 'Outside' })

    const result = (await getTool('audit_font_rendering').execute(figma, {
      scope: 'ids',
      ids: [frame.id],
      max_nodes: 1
    })) as FontAuditResult

    expect(result.summary).toMatchObject({
      complete: true,
      matchedTextAndButtonLabels: 2,
      auditedNodes: 2,
      returnedNodes: 1,
      omittedNodes: 1
    })
  })

  test('audits and retries the whole bounded scope when max_nodes only truncates details', async () => {
    const { figma, graph } = setupToolTest()
    const page = graph.getPages()[0]
    const readyFamily = 'OpenPencil Render Audit Truncated Ready'
    const missingFamily = 'OpenPencil Render Audit Truncated Missing'
    const ready = graph.createNode('TEXT', page.id, {
      text: 'Ready',
      fontFamily: readyFamily
    })
    const missing = graph.createNode('TEXT', page.id, {
      text: 'Missing',
      fontFamily: missingFamily
    })
    fontManager.markLoaded(readyFamily, 'Regular', new ArrayBuffer(1))
    fontManager.markLoaded(missingFamily, 'Regular', new ArrayBuffer(1))
    attachReadiness(figma, (id) => (id === ready.id ? 'ready' : 'exhausted'))

    const result = (await getTool('audit_font_rendering').execute(figma, {
      retry: true,
      max_retries: 1,
      max_nodes: 1,
      timeout_ms: 50
    })) as FontAuditResult

    expect(result.summary).toMatchObject({
      complete: true,
      matchedTextAndButtonLabels: 2,
      auditedNodes: 2,
      returnedNodes: 1,
      omittedNodes: 1,
      knownUnauditedNodes: 0,
      ready: 1,
      notReady: 1
    })
    expect(result.retry).toMatchObject({
      status: 'exhausted',
      complete: true,
      attempts: 1
    })
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes?.[0]?.id).toBe(ready.id)
    expect(missing.id).not.toBe(ready.id)
  })

  test('supports an explicit page and the whole document scope', async () => {
    const { figma, graph } = setupToolTest()
    const firstPage = graph.getPages()[0]
    const secondPage = graph.addPage('Second')
    graph.createNode('TEXT', firstPage.id, { text: 'First' })
    graph.createNode('TEXT', secondPage.id, { text: 'Second' })

    const pageResult = (await getTool('audit_font_rendering').execute(figma, {
      scope: 'page',
      page_id: secondPage.id
    })) as FontAuditResult
    const documentResult = (await getTool('audit_font_rendering').execute(figma, {
      scope: 'document'
    })) as FontAuditResult

    expect(pageResult.summary?.matchedTextAndButtonLabels).toBe(1)
    expect(documentResult.summary?.matchedTextAndButtonLabels).toBe(2)
  })

  test('distinguishes exact loaded and synthesized faces in a live renderer', async () => {
    const { figma, graph } = setupToolTest()
    const page = graph.getPages()[0]
    const exactFamily = 'OpenPencil Render Audit Exact'
    const syntheticFamily = 'OpenPencil Render Audit Synthetic'
    graph.createNode('TEXT', page.id, {
      text: 'Exact',
      fontFamily: exactFamily,
      fontWeight: 400
    })
    graph.createNode('TEXT', page.id, {
      text: 'Synthetic',
      fontFamily: syntheticFamily,
      fontWeight: 700
    })
    fontManager.markLoaded(exactFamily, 'Regular', new ArrayBuffer(1))
    fontManager.markLoaded(syntheticFamily, 'Regular', new ArrayBuffer(1))
    attachReadiness(figma, () => 'ready')

    const result = (await getTool('audit_font_rendering').execute(figma, {})) as FontAuditResult

    expect(result.summary).toMatchObject({ ready: 1, degraded: 1, unverifiable: 0 })
    expect(result.nodes?.[0]).toMatchObject({ renderReady: 'ready', exactFacesLoaded: true })
    expect(result.nodes?.[0]?.actualFaces[0]).toMatchObject({
      mode: 'exact',
      loadedFamily: exactFamily,
      loadedStyle: 'Regular'
    })
    expect(result.nodes?.[1]).toMatchObject({ renderReady: 'degraded', exactFacesLoaded: false })
    expect(result.nodes?.[1]?.actualFaces[0]).toMatchObject({
      mode: 'synthesized',
      loadedFamily: syntheticFamily,
      loadedStyle: null
    })
  })

  test('returns unverifiable instead of retry success when no renderer is attached', async () => {
    const { figma, graph } = setupToolTest()
    graph.createNode('TEXT', graph.getPages()[0].id, { text: 'No renderer' })

    const result = (await getTool('audit_font_rendering').execute(figma, {
      retry: true,
      timeout_ms: 50
    })) as FontAuditResult

    expect(result.retry).toMatchObject({
      requested: true,
      status: 'unverifiable',
      attempts: 0,
      timeoutMs: 50
    })
    expect(result.retry?.reason).toContain('No live CanvasKit renderer')
  })

  test('bounded retry observes a renderer transition from pending to ready', async () => {
    const { figma, graph } = setupToolTest()
    const family = 'OpenPencil Render Audit Retry'
    graph.createNode('TEXT', graph.getPages()[0].id, { text: 'Retry', fontFamily: family })
    fontManager.markLoaded(family, 'Regular', new ArrayBuffer(1))
    let readinessCalls = 0
    attachReadiness(figma, () => (++readinessCalls < 3 ? 'pending' : 'ready'))

    const result = (await getTool('audit_font_rendering').execute(figma, {
      retry: true,
      max_retries: 1,
      timeout_ms: 200
    })) as FontAuditResult

    expect(result.retry).toMatchObject({ status: 'settled', attempts: 1, timeoutMs: 200 })
    expect(result.summary).toMatchObject({ ready: 1, pending: 0 })
  })

  test('bounded retry times out while readiness remains pending', async () => {
    const { figma, graph } = setupToolTest()
    const family = 'OpenPencil Render Audit Timeout'
    graph.createNode('TEXT', graph.getPages()[0].id, { text: 'Pending', fontFamily: family })
    fontManager.markLoaded(family, 'Regular', new ArrayBuffer(1))
    attachReadiness(figma, () => 'pending')

    const result = (await getTool('audit_font_rendering').execute(figma, {
      retry: true,
      timeout_ms: 50
    })) as FontAuditResult

    expect(result.retry).toMatchObject({ status: 'timed_out', attempts: 1, timeoutMs: 50 })
    expect(result.summary).toMatchObject({ pending: 1 })
  })

  test('rejects missing ids and incompatible scope parameters', async () => {
    const { figma } = setupToolTest()
    const missingIds = (await getTool('audit_font_rendering').execute(figma, {
      scope: 'ids'
    })) as FontAuditResult
    const incompatible = (await getTool('audit_font_rendering').execute(figma, {
      scope: 'document',
      ids: ['0:1']
    })) as FontAuditResult

    expect(missingIds.error).toContain('ids is required')
    expect(incompatible.error).toContain('ids can only')
  })

  test('marks the scope and retry partial when the hard font-node audit limit is reached', async () => {
    const { figma, graph } = setupToolTest()
    const page = graph.getPages()[0]
    for (let index = 0; index < 2_001; index++) {
      graph.createNode('TEXT', page.id, { text: `Node ${index}` })
    }

    const result = (await getTool('audit_font_rendering').execute(figma, {
      retry: true,
      max_nodes: 1,
      timeout_ms: 50
    })) as FontAuditResult

    expect(result.summary).toMatchObject({
      complete: false,
      matchedTextAndButtonLabels: 2_001,
      auditedNodes: 2_000,
      returnedNodes: 1,
      omittedNodes: 1_999,
      knownUnauditedNodes: 1
    })
    expect(result.retry).toMatchObject({
      status: 'partial',
      complete: false,
      auditedStatus: 'unverifiable',
      attempts: 0
    })
  })
})
