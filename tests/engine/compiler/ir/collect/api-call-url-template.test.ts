import { beforeAll, describe, expect, test } from 'bun:test'

import { collectTree } from '#compiler/ir/collect/tree'
import type { IRApiCallHandler } from '#compiler/ir/types'

import { SceneGraph, initCodec } from '@open-pencil/core'
import type { ActionDef } from '@open-pencil/core/scene-graph'

/**
 * Phase 2 §4 — `apiCall` URL templating. The URL is parsed as a `${}`
 * template; its interpolation identifiers resolve as a read context
 * (page state / docState / in-scope item|index). Failures — an
 * unterminated `${`, an unknown identifier, a `$prev` reference — drop
 * the handler with a warning.
 */
describe('resolveApiCall — URL template (Phase 2 §4)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  /** A BUTTON whose onClick fires `apiCall`; the document declares a
   *  `user` docState, the page a `userId` state. */
  function makeGraph(url: string): { graph: SceneGraph; pageId: string } {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd-user', name: 'user', type: 'object', defaultValue: {} }]
    })
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's-uid', name: 'userId', type: 'number', defaultValue: 1 }]
    })
    const onClick: ActionDef[] = [
      { id: 'a1', kind: 'apiCall', method: 'GET', url, targetName: 'user' }
    ]
    graph.createNode('BUTTON', page.id, { events: { onClick } })
    return { graph, pageId: page.id }
  }

  function handlerOf(graph: SceneGraph, pageId: string): IRApiCallHandler | undefined {
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    const h = button.events?.onClick?.[0]
    return h?.kind === 'apiCall' ? h : undefined
  }

  test('static URL → degenerate zero-expression template', () => {
    const { graph, pageId } = makeGraph('https://x.test/users')
    expect(handlerOf(graph, pageId)?.url).toEqual({
      kind: 'template',
      quasis: ['https://x.test/users'],
      expressions: []
    })
  })

  test('URL interpolating a page state resolves', () => {
    const { graph, pageId } = makeGraph('https://x.test/users/${userId}')
    const h = handlerOf(graph, pageId)
    expect(h?.url.kind).toBe('template')
    if (h?.url.kind !== 'template') return
    expect(h.url.expressions).toEqual([{ kind: 'ident', name: 'userId' }])
    expect(collectTree(graph, pageId).warnings).toEqual([])
  })

  test('URL interpolating a docState resolves and registers a read', () => {
    const { graph, pageId } = makeGraph('https://x.test/u/${user.id}')
    const ir = collectTree(graph, pageId)
    expect(ir.warnings).toEqual([])
    expect(ir.docStateReads).toContain('user')
  })

  test('unterminated ${ → action-apicall-invalid-url, handler dropped', () => {
    const { graph, pageId } = makeGraph('https://x.test/${userId')
    expect(handlerOf(graph, pageId)).toBeUndefined()
    expect(
      collectTree(graph, pageId).warnings.some((w) => w.code === 'action-apicall-invalid-url')
    ).toBe(true)
  })

  test('unknown identifier in URL → action-apicall-unknown-identifier, dropped', () => {
    const { graph, pageId } = makeGraph('https://x.test/${ghost}')
    expect(handlerOf(graph, pageId)).toBeUndefined()
    expect(
      collectTree(graph, pageId).warnings.some(
        (w) => w.code === 'action-apicall-unknown-identifier'
      )
    ).toBe(true)
  })

  test('$prev in URL → expression-prev-out-of-context, dropped', () => {
    const { graph, pageId } = makeGraph('https://x.test/${$prev}')
    expect(handlerOf(graph, pageId)).toBeUndefined()
    expect(
      collectTree(graph, pageId).warnings.some((w) => w.code === 'expression-prev-out-of-context')
    ).toBe(true)
  })

  test('a dropped apiCall (bad URL) records no docStateWrite', () => {
    const { graph, pageId } = makeGraph('https://x.test/${ghost}')
    expect(collectTree(graph, pageId).docStateWrites).not.toContain('user')
  })

  test('URL interpolating a LIST item resolves against in-scope identifiers', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd-sel', name: 'selected', type: 'object', defaultValue: {} }]
    })
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's-rows', name: 'rows', type: 'array', defaultValue: [] }]
    })
    const list = graph.createNode('LIST', page.id, {
      name: 'List',
      width: 200,
      height: 200,
      interactiveProps: { dataSourceRef: { kind: 'stateRef', stateId: 's-rows' } }
    })
    graph.createNode('BUTTON', list.id, {
      events: {
        onClick: [
          {
            id: 'a1',
            kind: 'apiCall',
            method: 'GET',
            url: 'https://x.test/rows/${item.id}',
            targetName: 'selected'
          }
        ]
      }
    })
    expect(collectTree(graph, page.id).warnings).toEqual([])
  })
})
