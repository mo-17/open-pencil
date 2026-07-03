import { beforeAll, describe, expect, test } from 'bun:test'

import { emitEventHandler } from '@open-pencil/compiler/adapters/react/emit/event'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRStripeCustomerPortalHandler } from '@open-pencil/compiler/ir/types'
import { SceneGraph, initCodec } from '@open-pencil/core'
import type { ActionDef } from '@open-pencil/core/scene-graph'

function setupGraph(onClick: ActionDef[]): { graph: SceneGraph; pageId: string } {
  const graph = new SceneGraph()
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'd-customer', name: 'customerId', type: 'string', defaultValue: 'cus_123' },
      { id: 'd-error', name: 'portalError', type: 'object', defaultValue: null }
    ]
  })
  const page = graph.getPages()[0]
  graph.createNode('BUTTON', page.id, { events: { onClick } })
  return { graph, pageId: page.id }
}

function firstPortalHandler(
  graph: SceneGraph,
  pageId: string
): IRStripeCustomerPortalHandler | undefined {
  const ir = collectTree(graph, pageId)
  const button = ir.children[0]
  if (!button || button.kind !== 'element') return undefined
  const handler = button.events?.onClick?.[0]
  return handler?.kind === 'stripeCustomerPortal' ? handler : undefined
}

describe('stripeCustomerPortal action (Phase 5 §12)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('collects endpoint template, payload entries, and error target', () => {
    const { graph, pageId } = setupGraph([
      {
        id: 'portal',
        kind: 'stripeCustomerPortal',
        endpoint: '/api/${customerId}/customer-portal',
        payloadEntries: [{ key: 'customerId', valueExpr: 'customerId' }],
        errorTarget: 'portalError'
      }
    ])

    const handler = firstPortalHandler(graph, pageId)
    expect(handler?.endpoint).toEqual({
      kind: 'template',
      quasis: ['/api/', '/customer-portal'],
      expressions: [{ kind: 'ident', name: 'customerId' }]
    })
    expect(handler?.payloadEntries?.map((entry) => entry.key)).toEqual(['customerId'])
    expect(handler?.payloadEntries?.[0].references).toEqual(['customerId'])
    expect(handler?.errorTarget).toBe('portalError')
  })

  test('emits POST to author endpoint and redirects to returned portal URL', () => {
    const { graph, pageId } = setupGraph([
      {
        id: 'portal',
        kind: 'stripeCustomerPortal',
        endpoint: '/api/customer-portal',
        payloadEntries: [{ key: 'customerId', valueExpr: 'customerId' }],
        errorTarget: 'portalError'
      }
    ])
    const handler = firstPortalHandler(graph, pageId)
    if (!handler) throw new Error('missing stripeCustomerPortal handler')

    const out = emitEventHandler([handler])
    expect(out.startsWith('async () => {')).toBe(true)
    expect(out).toContain('await fetch("/api/customer-portal", { method: "POST"')
    expect(out).toContain('body: JSON.stringify({ "customerId": customerId })')
    expect(out).toContain('const portalUrl = data?.url ?? data?.portalUrl')
    expect(out).toContain('const nextUrl = new URL(portalUrl, window.location.href)')
    expect(out).toContain('if (nextUrl.protocol !== "https:" && nextUrl.protocol !== "http:")')
    expect(out).toContain('throw new Error("stripeCustomerPortal response url must be http(s)")')
    expect(out).toContain('window.location.assign(nextUrl.toString())')
    expect(out).toContain('setDocState("portalError", err)')
    expect(out).toContain('console.error("stripeCustomerPortal failed:", err)')
    expect(out).not.toContain('sk_test')
  })

  test('includeAuthToken emits Supabase bearer header lookup', () => {
    const { graph, pageId } = setupGraph([
      {
        id: 'portal',
        kind: 'stripeCustomerPortal',
        endpoint: '/api/customer-portal',
        includeAuthToken: true
      }
    ])
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: {
        url: 'https://example.supabase.co',
        anonKey: 'anon-key'
      }
    })
    const handler = firstPortalHandler(graph, pageId)
    if (!handler) throw new Error('missing stripeCustomerPortal handler')

    const out = emitEventHandler([handler])
    expect(out).toContain('await getSupabaseClient().auth.getSession()')
    expect(out).toContain('headers: { "Content-Type": "application/json", ...authHeaders }')
  })

  test('includeAuthToken without Supabase config drops the handler with a portal warning', () => {
    const { graph, pageId } = setupGraph([
      {
        id: 'portal',
        kind: 'stripeCustomerPortal',
        endpoint: '/api/customer-portal',
        includeAuthToken: true
      }
    ])
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (!button || button.kind !== 'element') throw new Error('expected button element')

    expect(button.events?.onClick).toBeUndefined()
    expect(ir.warnings).toContainEqual(
      expect.objectContaining({
        code: 'action-stripe-customer-portal-auth-token-without-supabase'
      })
    )
  })

  test('missing endpoint drops the handler with a portal-specific warning', () => {
    const { graph, pageId } = setupGraph([{ id: 'portal', kind: 'stripeCustomerPortal' }])
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (!button || button.kind !== 'element') throw new Error('expected button element')

    expect(button.events?.onClick).toBeUndefined()
    expect(ir.warnings).toContainEqual(
      expect.objectContaining({ code: 'action-stripe-customer-portal-missing-endpoint' })
    )
  })
})
