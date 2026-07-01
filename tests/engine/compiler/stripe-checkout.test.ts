import { beforeAll, describe, expect, test } from 'bun:test'

import { emitEventHandler } from '@open-pencil/compiler/adapters/react/emit/event'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRStripeCheckoutHandler } from '@open-pencil/compiler/ir/types'
import { SceneGraph, initCodec } from '@open-pencil/core'
import type { ActionDef } from '@open-pencil/core/scene-graph'

function setupGraph(onClick: ActionDef[]): { graph: SceneGraph; pageId: string } {
  const graph = new SceneGraph()
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'd-price', name: 'priceId', type: 'string', defaultValue: 'price_123' },
      { id: 'd-error', name: 'checkoutError', type: 'object', defaultValue: null }
    ]
  })
  const page = graph.getPages()[0]
  graph.createNode('BUTTON', page.id, { events: { onClick } })
  return { graph, pageId: page.id }
}

function firstStripeHandler(
  graph: SceneGraph,
  pageId: string
): IRStripeCheckoutHandler | undefined {
  const ir = collectTree(graph, pageId)
  const button = ir.children[0]
  if (!button || button.kind !== 'element') return undefined
  const handler = button.events?.onClick?.[0]
  return handler?.kind === 'stripeCheckout' ? handler : undefined
}

describe('stripeCheckout action (Phase 5 §12)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('collects endpoint template, payload entries, and error target', () => {
    const { graph, pageId } = setupGraph([
      {
        id: 'checkout',
        kind: 'stripeCheckout',
        endpoint: '/api/${priceId}/checkout',
        payloadEntries: [
          { key: 'priceId', valueExpr: 'priceId' },
          { key: 'quantity', valueExpr: '1' }
        ],
        errorTarget: 'checkoutError'
      }
    ])

    const handler = firstStripeHandler(graph, pageId)
    expect(handler?.endpoint).toEqual({
      kind: 'template',
      quasis: ['/api/', '/checkout'],
      expressions: [{ kind: 'ident', name: 'priceId' }]
    })
    expect(handler?.payloadEntries?.map((entry) => entry.key)).toEqual(['priceId', 'quantity'])
    expect(handler?.payloadEntries?.[0].references).toEqual(['priceId'])
    expect(handler?.errorTarget).toBe('checkoutError')
  })

  test('emits POST to author endpoint and redirects to returned checkout URL', () => {
    const { graph, pageId } = setupGraph([
      {
        id: 'checkout',
        kind: 'stripeCheckout',
        endpoint: '/api/checkout',
        payloadEntries: [{ key: 'priceId', valueExpr: 'priceId' }],
        errorTarget: 'checkoutError'
      }
    ])
    const handler = firstStripeHandler(graph, pageId)
    if (!handler) throw new Error('missing stripeCheckout handler')

    const out = emitEventHandler([handler])
    expect(out.startsWith('async () => {')).toBe(true)
    expect(out).toContain('await fetch("/api/checkout", { method: "POST"')
    expect(out).toContain('body: JSON.stringify({ "priceId": priceId })')
    expect(out).toContain('const checkoutUrl = data?.url ?? data?.checkoutUrl')
    expect(out).toContain('window.location.assign(checkoutUrl)')
    expect(out).toContain('setDocState("checkoutError", err)')
    expect(out).not.toContain('sk_test')
  })

  test('missing endpoint drops the handler with a warning', () => {
    const { graph, pageId } = setupGraph([{ id: 'checkout', kind: 'stripeCheckout' }])
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (!button || button.kind !== 'element') throw new Error('expected button element')

    expect(button.events?.onClick).toBeUndefined()
    expect(ir.warnings).toContainEqual(
      expect.objectContaining({ code: 'action-stripe-checkout-missing-endpoint' })
    )
  })
})
