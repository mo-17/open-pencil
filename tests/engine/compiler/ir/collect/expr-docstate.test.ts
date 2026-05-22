import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'
import type { DocumentStateDef, StateDef } from '@open-pencil/core/scene-graph'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'

/**
 * Phase 2 §4 — a Document State name may be referenced from a read-context
 * expression: a `kind: 'expr'` text binding and a node `renderCondition`.
 * The collector adds the matching name to `IRTree.docStateReads` so the
 * React adapter emits the `useDocState(...)` local. Write-context valueExpr
 * is deliberately NOT widened (decision §4.2 #3 — respects §2.2 #h).
 */

const DOC_STATES: DocumentStateDef[] = [
  { id: 'd1', name: 'user', type: 'object', defaultValue: {} },
  { id: 'd2', name: 'count', type: 'number', defaultValue: 0 }
]

function withDocStates(): SceneGraph {
  const graph = new SceneGraph()
  graph.updateNode(graph.rootId, { lowcodeDocumentState: DOC_STATES })
  return graph
}

describe('text binding kind:"expr" — docState references (Phase 2 §4)', () => {
  function makeTextExpr(expr: string, pageStates: StateDef[] = []): { ir: ReturnType<typeof collectTree> } {
    const graph = withDocStates()
    const page = graph.getPages()[0]
    if (pageStates.length > 0) graph.updateNode(page.id, { state: pageStates })
    graph.createNode('TEXT', page.id, {
      text: 'fallback',
      bindings: { text: { kind: 'expr', expr } }
    })
    return { ir: collectTree(graph, page.id) }
  }

  test('expr referencing a docState resolves and registers a read', () => {
    const { ir } = makeTextExpr('user.name')
    const text = ir.children[0]
    if (text.kind !== 'element') throw new Error('expected element')
    const child = text.children[0]
    if (child.kind !== 'expression') throw new Error('expected expression child')
    expect(child.references).toEqual(['user'])
    expect(ir.docStateReads).toContain('user')
    expect(ir.warnings).toEqual([])
  })

  test('expr mixing a page state and a docState resolves both', () => {
    const { ir } = makeTextExpr('count + offset', [
      { id: 's1', name: 'offset', type: 'number', defaultValue: 1 }
    ])
    const text = ir.children[0]
    if (text.kind !== 'element') throw new Error('expected element')
    const child = text.children[0]
    if (child.kind !== 'expression') throw new Error('expected expression child')
    // `count` is a docState → registered; `offset` is a page state → not.
    expect(ir.docStateReads).toEqual(['count'])
    expect(ir.warnings).toEqual([])
  })

  test('a genuinely unknown identifier is still flagged', () => {
    const { ir } = makeTextExpr('ghost + 1')
    const text = ir.children[0]
    if (text.kind !== 'element') throw new Error('expected element')
    expect(text.children[0]).toEqual({ kind: 'text', value: 'fallback' })
    expect(ir.warnings.some((w) => w.code === 'binding-unknown-identifier')).toBe(true)
    expect(ir.docStateReads).toEqual([])
  })
})

describe('renderCondition — docState references (Phase 2 §4)', () => {
  function makeConditionalFrame(condition: string): ReturnType<typeof collectTree> {
    const graph = withDocStates()
    const page = graph.getPages()[0]
    graph.createNode('FRAME', page.id, { name: 'Gated', renderCondition: condition })
    return collectTree(graph, page.id)
  }

  test('renderCondition referencing a docState wraps in a conditional + registers a read', () => {
    const ir = makeConditionalFrame('count > 0')
    const node = ir.children[0]
    expect(node.kind).toBe('conditional')
    if (node.kind !== 'conditional') return
    expect(node.references).toEqual(['count'])
    expect(ir.docStateReads).toContain('count')
    expect(ir.warnings).toEqual([])
  })

  test('renderCondition with an unknown identifier still warns and degrades', () => {
    const ir = makeConditionalFrame('ghost > 0')
    expect(ir.children[0].kind).toBe('element')
    expect(ir.warnings.some((w) => w.code === 'condition-unknown-identifier')).toBe(true)
    expect(ir.docStateReads).toEqual([])
  })
})
