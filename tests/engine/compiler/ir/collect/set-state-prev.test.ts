import { describe, expect, test } from 'bun:test'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import { SceneGraph } from '@open-pencil/core'
import type { StateDef } from '@open-pencil/scene-graph'

/**
 * Phase 2 §2 — setState picks `mode: 'functional'` when valueExpr references
 * the reserved `$prev` identifier, otherwise stays `mode: 'absolute'`. The
 * AST is rewritten so `$prev` becomes the formal parameter `prev`, ready for
 * the adapter to splice into `setX((prev) => ...)`.
 */
describe('resolveSetState — $prev functional updater (Phase 2 §2)', () => {
  function makeButton(
    pageStates: StateDef[],
    valueExpr: string,
    targetId = pageStates[0]?.id ?? ''
  ): { graph: SceneGraph; pageId: string } {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, { state: pageStates })
    graph.createNode('BUTTON', page.id, {
      events: {
        onClick: [{ id: 'a1', kind: 'setState', targetStateId: targetId, valueExpr }]
      }
    })
    return { graph, pageId: page.id }
  }

  test('no $prev → mode="absolute" (backwards-compat with Phase 1)', () => {
    const { graph, pageId } = makeButton(
      [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }],
      'count + 1'
    )
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    const handler = button.events?.onClick?.[0]
    if (handler?.kind !== 'setState') throw new Error('expected setState handler')
    expect(handler.mode).toBe('absolute')
    expect(handler.references).toContain('count')
  })

  test('$prev + 1 → functional, AST rewrites $prev → prev, references drop $prev', () => {
    const { graph, pageId } = makeButton(
      [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }],
      '$prev + 1'
    )
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    const handler = button.events?.onClick?.[0]
    if (handler?.kind !== 'setState') throw new Error('expected setState handler')
    expect(handler.mode).toBe('functional')
    expect(handler.references).toEqual([])
    expect(handler.ast).toMatchObject({
      kind: 'binary',
      op: '+',
      left: { kind: 'ident', name: 'prev' },
      right: { kind: 'number', value: 1 }
    })
  })

  test('$prev mixed with a state ident → functional, references = [stateName]', () => {
    const { graph, pageId } = makeButton(
      [
        { id: 's1', name: 'count', type: 'number', defaultValue: 0 },
        { id: 's2', name: 'step', type: 'number', defaultValue: 1 }
      ],
      '$prev + step'
    )
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    const handler = button.events?.onClick?.[0]
    if (handler?.kind !== 'setState') throw new Error('expected setState handler')
    expect(handler.mode).toBe('functional')
    expect(handler.references).toEqual(['step'])
  })

  test('$prev mixed with an in-scope prev identifier is dropped as ambiguous', () => {
    const { graph, pageId } = makeButton(
      [
        { id: 's1', name: 'count', type: 'number', defaultValue: 0 },
        { id: 's2', name: 'prev', type: 'number', defaultValue: 10 }
      ],
      '$prev + prev'
    )
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')

    expect(button.events?.onClick).toBeUndefined()
    expect(ir.warnings).toContainEqual(
      expect.objectContaining({ code: 'action-functional-prev-ambiguous' })
    )
  })

  test('$prev in plain ident position (`$prev`) is the simplest functional form', () => {
    const { graph, pageId } = makeButton(
      [{ id: 's1', name: 'flag', type: 'boolean', defaultValue: false }],
      '!$prev'
    )
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    const handler = button.events?.onClick?.[0]
    if (handler?.kind !== 'setState') throw new Error('expected setState handler')
    expect(handler.mode).toBe('functional')
    expect(handler.ast).toMatchObject({
      kind: 'unary',
      op: '!',
      arg: { kind: 'ident', name: 'prev' }
    })
  })

  test('registers document-state reads used by a setState expression', () => {
    const { graph, pageId } = makeButton(
      [{ id: 'items', name: 'items', type: 'array', defaultValue: [] }],
      'incoming'
    )
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'incoming', name: 'incoming', type: 'array', defaultValue: ['ready'] }
      ]
    })

    const ir = collectTree(graph, pageId)

    expect(ir.docStateReads).toContain('incoming')
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    expect(button.events?.onClick?.[0]).toMatchObject({
      kind: 'setState',
      references: ['incoming']
    })
  })

  test('drops a setState expression with an unknown identifier', () => {
    const { graph, pageId } = makeButton(
      [{ id: 'count', name: 'count', type: 'number', defaultValue: 0 }],
      'missing + 1'
    )

    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')

    expect(button.events?.onClick).toBeUndefined()
    expect(ir.warnings).toContainEqual(
      expect.objectContaining({ code: 'action-setstate-unknown-identifier' })
    )
  })
})
