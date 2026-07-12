import { describe, expect, test } from 'bun:test'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import { SceneGraph } from '@open-pencil/core'
import type { BindingExpr, DocumentStateDef, StateDef } from '@open-pencil/scene-graph'

/**
 * Phase 2 §2 — bindings.text with `kind: 'docState'` resolves to an
 * IRExpression that references the docState name. The collector also
 * tracks the referenced names in `IRTree.docStateReads` so the React
 * adapter knows which `useDocState(...)` declarations to emit per page.
 * Separately: `kind: 'expr'` expressions reject `$prev` since it has
 * no meaning outside a setState / setVariable updater context.
 */
describe('text binding — kind:"docState" (Phase 2 §2)', () => {
  function makeTextWithBinding(
    docStates: DocumentStateDef[],
    bindings: Record<string, BindingExpr>
  ): { graph: SceneGraph; pageId: string } {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, { lowcodeDocumentState: docStates })
    const page = graph.getPages()[0]
    graph.createNode('TEXT', page.id, { text: 'fallback', bindings })
    return { graph, pageId: page.id }
  }

  test('valid kind:"docState" → IRExpression ident references docStateName', () => {
    const { graph, pageId } = makeTextWithBinding(
      [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }],
      { text: { kind: 'docState', docStateName: 'cartCount' } }
    )
    const ir = collectTree(graph, pageId)
    const text = ir.children[0]
    if (text.kind !== 'element') throw new Error('expected element')
    const child = text.children[0]
    if (child.kind !== 'expression') throw new Error('expected expression child')
    expect(child.ast).toEqual({ kind: 'ident', name: 'cartCount' })
    expect(child.references).toEqual(['cartCount'])
    expect(ir.docStateReads).toContain('cartCount')
    // a read is not a write — should not appear in docStateWrites.
    expect(ir.docStateWrites).toEqual([])
    expect(ir.warnings).toEqual([])
  })

  test('unknown docStateName → warning, falls back to literal', () => {
    const { graph, pageId } = makeTextWithBinding(
      [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }],
      { text: { kind: 'docState', docStateName: 'ghost' } }
    )
    const ir = collectTree(graph, pageId)
    const text = ir.children[0]
    if (text.kind !== 'element') throw new Error('expected element')
    // Falls back to the static `node.text` literal.
    expect(text.children[0]).toEqual({ kind: 'text', value: 'fallback' })
    expect(ir.warnings.some((w) => w.code === 'binding-docstate-unknown-name')).toBe(true)
    // Unknown name is NOT added to docStateReads (nothing to emit a hook for).
    expect(ir.docStateReads).toEqual([])
  })

  test('missing docStateName → warning, falls back', () => {
    const { graph, pageId } = makeTextWithBinding(
      [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }],
      { text: { kind: 'docState' } }
    )
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'binding-docstate-missing-name')).toBe(true)
  })
})

describe('text binding — kind:"expr" rejects $prev (Phase 2 §2)', () => {
  function makeTextWithExpr(
    expr: string,
    pageStates: StateDef[] = []
  ): { graph: SceneGraph; pageId: string } {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, { state: pageStates })
    graph.createNode('TEXT', page.id, {
      text: 'fallback',
      bindings: { text: { kind: 'expr', expr } }
    })
    return { graph, pageId: page.id }
  }

  test('expr referencing $prev → warning, falls back', () => {
    const { graph, pageId } = makeTextWithExpr('$prev', [])
    const ir = collectTree(graph, pageId)
    const text = ir.children[0]
    if (text.kind !== 'element') throw new Error('expected element')
    expect(text.children[0]).toEqual({ kind: 'text', value: 'fallback' })
    expect(ir.warnings.some((w) => w.code === 'expression-prev-out-of-context')).toBe(true)
  })

  test('expr mixing $prev with a real state → still flagged', () => {
    const { graph, pageId } = makeTextWithExpr('$prev + count', [
      { id: 's1', name: 'count', type: 'number', defaultValue: 0 }
    ])
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'expression-prev-out-of-context')).toBe(true)
  })

  test('expr with no $prev parses normally', () => {
    const { graph, pageId } = makeTextWithExpr('count + 1', [
      { id: 's1', name: 'count', type: 'number', defaultValue: 0 }
    ])
    const ir = collectTree(graph, pageId)
    const text = ir.children[0]
    if (text.kind !== 'element') throw new Error('expected element')
    const child = text.children[0]
    if (child.kind !== 'expression') throw new Error('expected expression child')
    expect(child.references).toContain('count')
    expect(ir.warnings.every((w) => w.code !== 'expression-prev-out-of-context')).toBe(true)
  })
})

describe('renderCondition rejects $prev (Phase 2 §2)', () => {
  test('node.renderCondition with $prev → warning, node still rendered', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's1', name: 'flag', type: 'boolean', defaultValue: true }]
    })
    graph.createNode('FRAME', page.id, {
      name: 'Conditional',
      renderCondition: 'flag && $prev'
    })
    const ir = collectTree(graph, page.id)
    expect(ir.warnings.some((w) => w.code === 'expression-prev-out-of-context')).toBe(true)
    // Decision §9.2 #8 — node stays visible so the user can fix in place.
    const node = ir.children[0]
    expect(node.kind).toBe('element')
  })
})
