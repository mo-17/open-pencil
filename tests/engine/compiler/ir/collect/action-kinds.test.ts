import { beforeAll, describe, expect, test } from 'bun:test'

import { collectTree } from '#compiler/ir/collect/tree'

import { SceneGraph, initCodec } from '@open-pencil/core'
import type { ActionDef } from '@open-pencil/scene-graph'

/**
 * Phase 1 §7.4 — exercise the discriminated-union dispatch in
 * `collect/bindings.ts`. setState was the only kind in Phase 0; this suite
 * pins the new branches and the unsupported-kind fallback.
 */
describe('resolveActions — discriminated kind dispatch', () => {
  beforeAll(async () => {
    await initCodec()
  })

  function makeButtonWith(events: { onClick: ActionDef[] }): {
    graph: SceneGraph
    pageId: string
  } {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's-c', name: 'count', type: 'number', defaultValue: 0 }]
    })
    graph.createNode('BUTTON', page.id, { events })
    return { graph, pageId: page.id }
  }

  test('navigate with non-empty `to` produces an IRNavigateHandler', () => {
    const { graph, pageId } = makeButtonWith({
      onClick: [{ id: 'a1', kind: 'navigate', to: '/about' }]
    })
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    const handlers = button.events?.onClick ?? []
    expect(handlers).toHaveLength(1)
    expect(handlers[0]).toEqual({ kind: 'navigate', to: '/about' })
    expect(ir.warnings).toEqual([])
  })

  test('navigate with empty `to` is dropped with a warning', () => {
    const { graph, pageId } = makeButtonWith({
      onClick: [{ id: 'a1', kind: 'navigate', to: '' }]
    })
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    expect(button.events?.onClick).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-navigate-missing-to')).toBe(true)
  })

  test('navigate trims whitespace-only `to` and treats it as empty', () => {
    const { graph, pageId } = makeButtonWith({
      onClick: [{ id: 'a1', kind: 'navigate', to: '   ' }]
    })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-navigate-missing-to')).toBe(true)
  })

  test('setVariable targeting an unknown docState is dropped with a warning (Phase 2 §2)', () => {
    const { graph, pageId } = makeButtonWith({
      onClick: [{ id: 'a1', kind: 'setVariable', targetName: 'cookie', valueExpr: '1' }]
    })
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    expect(button.events?.onClick).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-setvariable-unknown-target')).toBe(true)
  })

  test('unknown kind from a future .fig file is dropped with a warning', () => {
    // A future .fig saved by a newer build could carry an action kind this
    // build has never heard of. The unsupported-kind branch is the backstop.
    // `Partial<ActionDef>` is the narrowest type that lets the test express
    // "shape that won't ever satisfy the current union".
    const future = { id: 'a1', kind: 'teleport' } as Partial<ActionDef> as ActionDef
    const { graph, pageId } = makeButtonWith({ onClick: [future] })
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-unsupported-kind')).toBe(true)
  })

  test('mixed handlers: setState survives even when sibling navigate is invalid', () => {
    const { graph, pageId } = makeButtonWith({
      onClick: [
        { id: 'a1', kind: 'setState', targetStateId: 's-c', valueExpr: 'count + 1' },
        { id: 'a2', kind: 'navigate', to: '' }
      ]
    })
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    const handlers = button.events?.onClick ?? []
    expect(handlers).toHaveLength(1)
    expect(handlers[0].kind).toBe('setState')
    expect(ir.warnings.some((w) => w.code === 'action-navigate-missing-to')).toBe(true)
  })
})
