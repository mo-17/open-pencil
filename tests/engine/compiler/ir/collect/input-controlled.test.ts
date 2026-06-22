import { describe, expect, test } from 'bun:test'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import { SceneGraph } from '@open-pencil/core'
import type {
  ActionDef,
  BindingExpr,
  DocumentStateDef,
  StateDef
} from '@open-pencil/core/scene-graph'

/**
 * Phase 3 §3.x — INPUT controlled-input wiring via `bindings.value`. When a
 * string-typed docState or page-state is referenced through `value`, the
 * collector sets `IRElement.controlled` so the adapter emits a two-way bound
 * input (`value={read}` + synthesized `onChange` writer). Unsupported kinds
 * and non-string state types warn and fall back to uncontrolled emit. Since
 * Phase 4 §28, a user-defined onChange on a controlled INPUT is preserved and
 * composed after the synthesized writer by the React adapter.
 */
describe('INPUT bindings.value — controlled input (Phase 3 §3.x)', () => {
  function makeInput(opts: {
    docStates?: DocumentStateDef[]
    pageStates?: StateDef[]
    bindings?: Record<string, BindingExpr>
    events?: Record<string, ActionDef[]>
  }): { graph: SceneGraph; pageId: string; inputId: string } {
    const graph = new SceneGraph()
    if (opts.docStates) {
      graph.updateNode(graph.rootId, { lowcodeDocumentState: opts.docStates })
    }
    const page = graph.getPages()[0]
    if (opts.pageStates) {
      graph.updateNode(page.id, { state: opts.pageStates })
    }
    const input = graph.createNode('INPUT', page.id, {
      bindings: opts.bindings,
      events: opts.events
    })
    return { graph, pageId: page.id, inputId: input.id }
  }

  test('docState string → controlled IR + docStateReads/Writes both include name', () => {
    const { graph, pageId, inputId } = makeInput({
      docStates: [{ id: 'd1', name: 'formId', type: 'string', defaultValue: '' }],
      bindings: { value: { kind: 'docState', docStateName: 'formId' } }
    })
    const ir = collectTree(graph, pageId)
    const input = ir.children[0]
    if (input.kind !== 'element') throw new Error('expected element')
    expect(input.controlled).toEqual({
      read: 'formId',
      write: { kind: 'docState', name: 'formId', targetType: 'string' }
    })
    // Uncontrolled defaultValue must not leak through.
    expect(input.attrs.defaultValue).toBeUndefined()
    expect(ir.docStateReads).toContain('formId')
    expect(ir.docStateWrites).toContain('formId')
    expect(ir.warnings).toEqual([])
    expect(input.sourceId).toBe(inputId)
  })

  test('page-state ref string → controlled IR with state name as read', () => {
    const { graph, pageId } = makeInput({
      pageStates: [{ id: 's1', name: 'query', type: 'string', defaultValue: '' }],
      bindings: { value: { kind: 'ref', stateId: 's1' } }
    })
    const ir = collectTree(graph, pageId)
    const input = ir.children[0]
    if (input.kind !== 'element') throw new Error('expected element')
    expect(input.controlled).toEqual({
      read: 'query',
      write: { kind: 'state', name: 'query', targetType: 'string' }
    })
    expect(ir.warnings).toEqual([])
  })

  test('docState number → controlled IR with targetType: number', () => {
    const { graph, pageId } = makeInput({
      docStates: [{ id: 'd1', name: 'age', type: 'number', defaultValue: 0 }],
      bindings: { value: { kind: 'docState', docStateName: 'age' } }
    })
    const ir = collectTree(graph, pageId)
    const input = ir.children[0]
    if (input.kind !== 'element') throw new Error('expected element')
    expect(input.controlled).toEqual({
      read: 'age',
      write: { kind: 'docState', name: 'age', targetType: 'number' }
    })
    expect(ir.docStateReads).toContain('age')
    expect(ir.docStateWrites).toContain('age')
    expect(ir.warnings).toEqual([])
  })

  test('page-state ref number → controlled IR with targetType: number', () => {
    const { graph, pageId } = makeInput({
      pageStates: [{ id: 's1', name: 'quantity', type: 'number', defaultValue: 1 }],
      bindings: { value: { kind: 'ref', stateId: 's1' } }
    })
    const ir = collectTree(graph, pageId)
    const input = ir.children[0]
    if (input.kind !== 'element') throw new Error('expected element')
    expect(input.controlled).toEqual({
      read: 'quantity',
      write: { kind: 'state', name: 'quantity', targetType: 'number' }
    })
    expect(ir.warnings).toEqual([])
  })

  test('literal kind → warn binding-value-unsupported-kind, fallback uncontrolled', () => {
    const { graph, pageId } = makeInput({
      bindings: { value: { kind: 'literal', literalValue: 'hello' } }
    })
    const ir = collectTree(graph, pageId)
    const input = ir.children[0]
    if (input.kind !== 'element') throw new Error('expected element')
    expect(input.controlled).toBeUndefined()
    // Uncontrolled defaultValue from interactiveProps still survives.
    expect(input.attrs.placeholder).toBe('Enter text')
    expect(ir.warnings.some((w) => w.code === 'binding-value-unsupported-kind')).toBe(true)
  })

  test('docState boolean type → warn binding-value-bad-state-type, fallback uncontrolled', () => {
    const { graph, pageId } = makeInput({
      docStates: [{ id: 'd1', name: 'agreed', type: 'boolean', defaultValue: false }],
      bindings: { value: { kind: 'docState', docStateName: 'agreed' } }
    })
    const ir = collectTree(graph, pageId)
    const input = ir.children[0]
    if (input.kind !== 'element') throw new Error('expected element')
    expect(input.controlled).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'binding-value-bad-state-type')).toBe(true)
    // Rejected docState must NOT register as a read/write — the binding is
    // dropped at collect time so no `useDocState` should be emitted for it.
    expect(ir.docStateReads).toEqual([])
    expect(ir.docStateWrites).toEqual([])
  })

  test('controlled + user-defined onChange → preserve onChange for adapter composition', () => {
    const { graph, pageId } = makeInput({
      docStates: [
        { id: 'd1', name: 'formId', type: 'string', defaultValue: '' },
        { id: 'd2', name: 'other', type: 'string', defaultValue: '' }
      ],
      bindings: { value: { kind: 'docState', docStateName: 'formId' } },
      events: {
        onChange: [
          { id: 'a1', kind: 'setVariable', targetName: 'other', valueExpr: "'x'" }
        ] as ActionDef[]
      }
    })
    const ir = collectTree(graph, pageId)
    const input = ir.children[0]
    if (input.kind !== 'element') throw new Error('expected element')
    expect(input.controlled).toBeDefined()
    expect(input.events?.onChange?.[0]?.kind).toBe('setVariable')
    expect(ir.warnings).toEqual([])
  })
})
