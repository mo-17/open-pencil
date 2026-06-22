import { describe, expect, test } from 'bun:test'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import { SceneGraph } from '@open-pencil/core'
import type { DocumentStateDef, StateDef } from '@open-pencil/core/scene-graph'

/**
 * Phase 2 §2 — `bindings.ts` step 2: setVariable used to warn-and-drop. It
 * now resolves to a real `IRSetVariableHandler`, with `$prev` opting into
 * a functional updater. These tests exercise the new branches.
 */
describe('resolveSetVariable (Phase 2 §2)', () => {
  function makeButtonWith(
    docStates: DocumentStateDef[],
    pageStates: StateDef[],
    onClick: { id: string; kind: 'setVariable'; targetName?: string; valueExpr?: string }[]
  ): { graph: SceneGraph; pageId: string } {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, { lowcodeDocumentState: docStates })
    const page = graph.getPages()[0]
    graph.updateNode(page.id, { state: pageStates })
    graph.createNode('BUTTON', page.id, { events: { onClick } })
    return { graph, pageId: page.id }
  }

  test('absolute mode: literal value resolves to mode="absolute"', () => {
    const { graph, pageId } = makeButtonWith(
      [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }],
      [],
      [{ id: 'a1', kind: 'setVariable', targetName: 'cartCount', valueExpr: '5' }]
    )
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    const handler = button.events?.onClick?.[0]
    expect(handler).toEqual({
      kind: 'setVariable',
      docStateName: 'cartCount',
      ast: { kind: 'number', value: 5 },
      references: [],
      mode: 'absolute'
    })
    expect(ir.warnings).toEqual([])
  })

  test('functional mode: `$prev + 1` rewrites to `prev + 1` and strips $prev from references', () => {
    const { graph, pageId } = makeButtonWith(
      [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }],
      [],
      [{ id: 'a1', kind: 'setVariable', targetName: 'cartCount', valueExpr: '$prev + 1' }]
    )
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    const handler = button.events?.onClick?.[0]
    if (handler?.kind !== 'setVariable') throw new Error('expected setVariable handler')
    expect(handler.mode).toBe('functional')
    expect(handler.docStateName).toBe('cartCount')
    expect(handler.references).toEqual([])
    // AST should have `$prev` substituted with `prev`.
    expect(handler.ast).toMatchObject({
      kind: 'binary',
      op: '+',
      left: { kind: 'ident', name: 'prev' },
      right: { kind: 'number', value: 1 }
    })
  })

  test('targetName missing → warning, handler dropped', () => {
    const { graph, pageId } = makeButtonWith(
      [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }],
      [],
      [{ id: 'a1', kind: 'setVariable', valueExpr: '1' }]
    )
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    expect(button.events?.onClick).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-setvariable-missing-target')).toBe(true)
  })

  test('targetName references an unknown docState → warning, handler dropped', () => {
    const { graph, pageId } = makeButtonWith(
      [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }],
      [],
      [{ id: 'a1', kind: 'setVariable', targetName: 'ghost', valueExpr: '1' }]
    )
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-setvariable-unknown-target')).toBe(true)
  })

  test('valueExpr referencing another docState name → warning (decision §2.2 #h)', () => {
    // setVariable.valueExpr only resolves page-state identifiers and $prev.
    // Referencing `username` (another docState) is rejected as an unknown
    // identifier, not as a docState read.
    const { graph, pageId } = makeButtonWith(
      [
        { id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 },
        { id: 'd2', name: 'username', type: 'string', defaultValue: 'a' }
      ],
      [],
      [
        {
          id: 'a1',
          kind: 'setVariable',
          targetName: 'cartCount',
          valueExpr: 'username.length'
        }
      ]
    )
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-setvariable-unknown-identifier')).toBe(true)
  })

  test('valueExpr can reference page-state idents', () => {
    const { graph, pageId } = makeButtonWith(
      [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }],
      [{ id: 's1', name: 'pageStep', type: 'number', defaultValue: 1 }],
      [
        {
          id: 'a1',
          kind: 'setVariable',
          targetName: 'cartCount',
          valueExpr: '$prev + pageStep'
        }
      ]
    )
    const ir = collectTree(graph, pageId)
    const button = ir.children[0]
    if (button.kind !== 'element') throw new Error('expected element')
    const handler = button.events?.onClick?.[0]
    if (handler?.kind !== 'setVariable') throw new Error('expected setVariable handler')
    expect(handler.mode).toBe('functional')
    expect(handler.references).toEqual(['pageStep'])
  })

  test('invalid valueExpr → warning, handler dropped', () => {
    const { graph, pageId } = makeButtonWith(
      [{ id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 }],
      [],
      [
        {
          id: 'a1',
          kind: 'setVariable',
          targetName: 'cartCount',
          valueExpr: 'foo bar baz'
        }
      ]
    )
    const ir = collectTree(graph, pageId)
    expect(ir.warnings.some((w) => w.code === 'action-setvariable-invalid-expression')).toBe(true)
  })

  test('a valid setVariable adds the target name to IRTree.docStateWrites', () => {
    const { graph, pageId } = makeButtonWith(
      [
        { id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 },
        { id: 'd2', name: 'username', type: 'string', defaultValue: 'a' }
      ],
      [],
      [{ id: 'a1', kind: 'setVariable', targetName: 'cartCount', valueExpr: '1' }]
    )
    const ir = collectTree(graph, pageId)
    expect(ir.docStateWrites).toContain('cartCount')
    // username was declared but not referenced from this page.
    expect(ir.docStateWrites).not.toContain('username')
    // setVariable is a write, not a read — should NOT appear in docStateReads.
    expect(ir.docStateReads).toEqual([])
  })

  test('IRTree.docStates is hydrated from graph.rootNode.lowcodeDocumentState', () => {
    const { graph, pageId } = makeButtonWith(
      [
        { id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 },
        { id: 'd2', name: 'username', type: 'string', defaultValue: 'guest' }
      ],
      [],
      []
    )
    const ir = collectTree(graph, pageId)
    expect(ir.docStates).toHaveLength(2)
    expect(ir.docStates.map((d) => d.name).sort()).toEqual(['cartCount', 'username'])
  })

  test('docState with duplicate name → warning, second drop', () => {
    const { graph, pageId } = makeButtonWith(
      [
        { id: 'd1', name: 'cartCount', type: 'number', defaultValue: 0 },
        { id: 'd2', name: 'cartCount', type: 'number', defaultValue: 99 }
      ],
      [],
      []
    )
    const ir = collectTree(graph, pageId)
    expect(ir.docStates).toHaveLength(1)
    expect(ir.warnings.some((w) => w.code === 'docstate-duplicate-name')).toBe(true)
  })
})
