import { beforeAll, describe, expect, test } from 'bun:test'

import { SceneGraph, initCodec } from '@open-pencil/core'
import type { ActionDef } from '@open-pencil/core/scene-graph'

import { collectTree } from '#compiler/ir/collect/tree'
import type { IRApiCallHandler } from '#compiler/ir/types'

/**
 * Phase 2 §3 step 2 — `apiCall` IR collect.
 *
 * Three validation gates (non-empty URL, target resolves to a declared
 * Document State, POST body parses as JSON) and the `docStateWrites`
 * bookkeeping that drives the `setDocState` import.
 */
describe('resolveApiCall — apiCall IR collect (Phase 2 §3)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  /** A BUTTON with the given onClick actions; the document declares one
   *  Document State `users` (array) so apiCall has a valid target. */
  function makeGraph(onClick: ActionDef[]): { graph: SceneGraph; pageId: string } {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd-users', name: 'users', type: 'array', defaultValue: [] }]
    })
    const page = graph.getPages()[0]
    graph.createNode('BUTTON', page.id, { events: { onClick } })
    return { graph, pageId: page.id }
  }

  function onlyHandler(graph: SceneGraph, pageId: string): IRApiCallHandler | undefined {
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    const handler = button.events?.onClick?.[0]
    return handler?.kind === 'apiCall' ? handler : undefined
  }

  test('valid GET → IRApiCallHandler with body undefined', () => {
    const { graph, pageId } = makeGraph([
      { id: 'a1', kind: 'apiCall', method: 'GET', url: 'https://x.test/users', targetName: 'users' }
    ])
    // Phase 2 §4 — a static URL is a degenerate zero-expression template.
    expect(onlyHandler(graph, pageId)).toEqual({
      kind: 'apiCall',
      method: 'GET',
      url: { kind: 'template', quasis: ['https://x.test/users'], expressions: [] },
      body: undefined,
      docStateName: 'users'
    })
  })

  test('valid POST → body re-serialised to compact JSON', () => {
    const { graph, pageId } = makeGraph([
      {
        id: 'a1',
        kind: 'apiCall',
        method: 'POST',
        url: 'https://x.test/users',
        bodyJson: '{ "name" : "Alice" }',
        targetName: 'users'
      }
    ])
    expect(onlyHandler(graph, pageId)?.body).toBe('{"name":"Alice"}')
  })

  test('POST with no body → body undefined (bodyless POST is allowed)', () => {
    const { graph, pageId } = makeGraph([
      { id: 'a1', kind: 'apiCall', method: 'POST', url: 'https://x.test', targetName: 'users' }
    ])
    expect(onlyHandler(graph, pageId)?.body).toBeUndefined()
  })

  test('GET ignores bodyJson entirely', () => {
    const { graph, pageId } = makeGraph([
      {
        id: 'a1',
        kind: 'apiCall',
        method: 'GET',
        url: 'https://x.test',
        bodyJson: '{"ignored":true}',
        targetName: 'users'
      }
    ])
    expect(onlyHandler(graph, pageId)?.body).toBeUndefined()
  })

  test('empty url → action-apicall-missing-url, handler dropped', () => {
    const { graph, pageId } = makeGraph([
      { id: 'a1', kind: 'apiCall', method: 'GET', url: '   ', targetName: 'users' }
    ])
    const ir = collectTree(graph, pageId)
    expect(onlyHandler(graph, pageId)).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-apicall-missing-url')).toBe(true)
  })

  test('empty targetName → action-apicall-missing-target', () => {
    const { graph, pageId } = makeGraph([
      { id: 'a1', kind: 'apiCall', method: 'GET', url: 'https://x.test', targetName: '' }
    ])
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-apicall-missing-target')).toBe(true)
  })

  test('targetName not a declared docState → action-apicall-unknown-target', () => {
    const { graph, pageId } = makeGraph([
      { id: 'a1', kind: 'apiCall', method: 'GET', url: 'https://x.test', targetName: 'ghost' }
    ])
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-apicall-unknown-target')).toBe(true)
  })

  test('POST with malformed JSON body → action-apicall-invalid-body', () => {
    const { graph, pageId } = makeGraph([
      {
        id: 'a1',
        kind: 'apiCall',
        method: 'POST',
        url: 'https://x.test',
        bodyJson: "{name:'Alice'}",
        targetName: 'users'
      }
    ])
    const ir = collectTree(graph, pageId)
    expect(onlyHandler(graph, pageId)).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-apicall-invalid-body')).toBe(true)
  })

  test('a resolved apiCall records its target in docStateWrites', () => {
    const { graph, pageId } = makeGraph([
      { id: 'a1', kind: 'apiCall', method: 'GET', url: 'https://x.test', targetName: 'users' }
    ])
    const ir = collectTree(graph, pageId)
    expect(ir.docStateWrites).toContain('users')
  })

  test('a dropped apiCall does not record a docStateWrite', () => {
    const { graph, pageId } = makeGraph([
      { id: 'a1', kind: 'apiCall', method: 'GET', url: '', targetName: 'users' }
    ])
    const ir = collectTree(graph, pageId)
    expect(ir.docStateWrites).not.toContain('users')
  })
})
