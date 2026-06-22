import { beforeAll, describe, expect, test } from 'bun:test'

import { collectTree } from '#compiler/ir/collect/tree'
import type { IRNode } from '#compiler/ir/types'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph, initCodec } from '@open-pencil/core'
import type { StateValueType } from '@open-pencil/core/scene-graph'

/**
 * Phase 2 §3 — a LIST can use a document-level array Document State as its
 * data source (`dataSourceRef.kind === 'docStateRef'`), not just a page
 * state. This is what makes the apiCall → docState → LIST flow work: the
 * §9 LIST only knew page state until now.
 *
 * A LIST node compiles to a `<div>` element whose first child is the
 * `IRList` directive, so the directive is found by descending — not at the
 * tree's top level.
 */
function findList(nodes: IRNode[]): Extract<IRNode, { kind: 'list' }> | undefined {
  for (const node of nodes) {
    if (node.kind === 'list') return node
    if (node.kind === 'element') {
      const found = findList(node.children)
      if (found) return found
    }
  }
  return undefined
}

describe('LIST with a docState data source (Phase 2 §3)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  /** A page with a LIST bound to the named doc state, plus a TEXT child as
   *  the item template. `docType` controls the declared Document State type
   *  so the bad-type path can be exercised. */
  function makeGraph(
    docName: string,
    ref: unknown,
    docType: StateValueType = 'array'
  ): { graph: SceneGraph; pageId: string } {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'd1', name: docName, type: docType, defaultValue: docType === 'array' ? [] : '' }
      ]
    })
    const page = graph.getPages()[0]
    const list = graph.createNode('LIST', page.id, {
      interactiveProps: { dataSourceRef: ref, itemName: 'user' }
    })
    graph.createNode('TEXT', list.id, { text: 'row' })
    return { graph, pageId: page.id }
  }

  test('collectTree: docStateRef → IRList.arrayName + docStateReads entry', () => {
    const { graph, pageId } = makeGraph('users', { kind: 'docStateRef', docStateName: 'users' })
    const ir = collectTree(graph, pageId)
    const list = findList(ir.children)
    expect(list?.arrayName).toBe('users')
    // The page must subscribe so `const users = useDocState('users')` is declared.
    expect(ir.docStateReads).toContain('users')
    expect(ir.warnings).toEqual([])
  })

  test('single-page compile: `.map` iterates the useDocState binding', () => {
    const { graph, pageId } = makeGraph('users', { kind: 'docStateRef', docStateName: 'users' })
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'list-docstate' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('const users = useDocState("users")')
    expect(app).toContain('(users).map((user, index)')
  })

  test('docStateRef to an unknown doc state → list-unknown-datasource', () => {
    const { graph, pageId } = makeGraph('users', { kind: 'docStateRef', docStateName: 'ghost' })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'list-unknown-datasource')).toBe(true)
  })

  test('docStateRef to a non-array doc state → list-bad-datasource-type', () => {
    const { graph, pageId } = makeGraph(
      'username',
      { kind: 'docStateRef', docStateName: 'username' },
      'string'
    )
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'list-bad-datasource-type')).toBe(true)
  })

  test('a page-state stateRef still resolves (Phase 2 §9 regression)', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's1', name: 'rows', type: 'array', defaultValue: [] }]
    })
    const list = graph.createNode('LIST', page.id, {
      interactiveProps: { dataSourceRef: { kind: 'stateRef', stateId: 's1' }, itemName: 'row' }
    })
    graph.createNode('TEXT', list.id, { text: 'row' })
    const ir = collectTree(graph, page.id)
    expect(findList(ir.children)?.arrayName).toBe('rows')
    expect(ir.docStateReads).not.toContain('rows')
  })
})
