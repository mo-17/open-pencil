import { beforeAll, describe, expect, test } from 'bun:test'

import { SceneGraph, initCodec } from '@open-pencil/core'

import { collectTree } from '#compiler/ir/collect/tree'
import type { IRConditional, IRElement } from '#compiler/ir/types'

/**
 * Phase 2 §9 — `renderCondition` resolution. The signal lives on the
 * SceneNode and is parsed at collect time; valid expressions become an
 * IRConditional wrapping the original IRElement, parse failures and
 * unknown identifiers degrade to the unwrapped element with a warning
 * (decision §9.2 #8 — keep the node visible so users can fix it in place).
 */
describe('collectTree — renderCondition wrapping (Phase 2 §9)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  function makeGraphWithFrame(
    renderCondition: string | undefined,
    extraState: { id: string; name: string; type: 'number' | 'boolean'; defaultValue: unknown }[] = [
      { id: 's-flag', name: 'flag', type: 'boolean', defaultValue: false }
    ]
  ): { graph: SceneGraph; pageId: string } {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, { state: extraState })
    graph.createNode('FRAME', page.id, {
      name: 'Conditional',
      width: 100,
      height: 50,
      ...(renderCondition === undefined ? {} : { renderCondition })
    })
    return { graph, pageId: page.id }
  }

  test('non-empty valid expression wraps the IRElement in an IRConditional', () => {
    const { graph, pageId } = makeGraphWithFrame('flag')
    const ir = collectTree(graph, pageId)
    expect(ir.children).toHaveLength(1)
    const wrap = ir.children[0]
    expect(wrap.kind).toBe('conditional')
    if (wrap.kind !== 'conditional') throw new Error('expected conditional')
    expect(wrap.references).toEqual(['flag'])
    expect(wrap.ast).toEqual({ kind: 'ident', name: 'flag' })
    expect(wrap.consequent.kind).toBe('element')
    expect(ir.warnings).toEqual([])
  })

  test('binary expression `count > 0` parses into a binary AST', () => {
    const { graph, pageId } = makeGraphWithFrame('count > 0', [
      { id: 's-c', name: 'count', type: 'number', defaultValue: 0 }
    ])
    const ir = collectTree(graph, pageId)
    const wrap = ir.children[0] as IRConditional
    expect(wrap.kind).toBe('conditional')
    expect(wrap.ast.kind).toBe('binary')
    expect(wrap.references).toEqual(['count'])
  })

  test('empty / undefined renderCondition leaves the node unwrapped', () => {
    {
      const { graph, pageId } = makeGraphWithFrame(undefined)
      expect(collectTree(graph, pageId).children[0].kind).toBe('element')
    }
    {
      const { graph, pageId } = makeGraphWithFrame('')
      expect(collectTree(graph, pageId).children[0].kind).toBe('element')
    }
  })

  test('parse failure degrades to bare element + condition-invalid-expression warning', () => {
    const { graph, pageId } = makeGraphWithFrame('foo bar')
    const ir = collectTree(graph, pageId)
    expect(ir.children[0].kind).toBe('element')
    expect(ir.warnings.some((w) => w.code === 'condition-invalid-expression')).toBe(true)
  })

  test('unknown identifier degrades to bare element + condition-unknown-identifier warning', () => {
    const { graph, pageId } = makeGraphWithFrame('undeclared')
    const ir = collectTree(graph, pageId)
    expect(ir.children[0].kind).toBe('element')
    expect(ir.warnings.some((w) => w.code === 'condition-unknown-identifier')).toBe(true)
  })

  test('nested conditional: child + parent both carry renderCondition', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's-a', name: 'a', type: 'boolean', defaultValue: true }]
    })
    const parent = graph.createNode('FRAME', page.id, {
      name: 'parent',
      renderCondition: 'a'
    })
    graph.createNode('FRAME', parent.id, {
      name: 'child',
      renderCondition: 'a'
    })
    const ir = collectTree(graph, page.id)
    const outer = ir.children[0]
    if (outer.kind !== 'conditional') throw new Error('expected conditional outer')
    const outerEl = outer.consequent as IRElement
    expect(outerEl.kind).toBe('element')
    const inner = outerEl.children[0]
    expect(inner.kind).toBe('conditional')
  })
})
