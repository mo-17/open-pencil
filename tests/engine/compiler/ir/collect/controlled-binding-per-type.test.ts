import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'
import type {
  BindingExpr,
  DocumentStateDef,
  SceneNode,
  StateDef
} from '@open-pencil/core/scene-graph'

import { resolveValueBinding } from '@open-pencil/compiler/ir/collect/bindings'
import type { IRDocStateDecl, IRStateDecl, IRWarning } from '@open-pencil/compiler/ir/types'

/**
 * Phase 3 §3.v4 step 2 — `resolveValueBinding` per-node-type targetType
 * constraint. INPUT accepts string|number (§3.x baseline);
 * TEXTAREA/SELECT/RADIO/DATEPICKER accept string only; CHECKBOX/SWITCH
 * accept boolean only. Tests call `resolveValueBinding` directly to
 * exercise the per-type rule independently from the
 * `applyControlledInput` whitelist (which step 3 widens to cover all 7
 * types in the emit chain).
 */
function makeDocStates(decls: DocumentStateDef[]): ReadonlyMap<string, IRDocStateDecl> {
  const m = new Map<string, IRDocStateDecl>()
  for (const d of decls) m.set(d.name, d)
  return m
}

function makePageStates(decls: StateDef[]): Map<string, IRStateDecl> {
  const m = new Map<string, IRStateDecl>()
  for (const d of decls) m.set(d.id, d)
  return m
}

function makeNode(type: SceneNode['type'], bindingValue: BindingExpr): SceneNode {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  return graph.createNode(type, page.id, { bindings: { value: bindingValue } })
}

function makeNodeWithOptions(
  type: SceneNode['type'],
  bindingValue: BindingExpr,
  options: string[]
): SceneNode {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  return graph.createNode(type, page.id, {
    bindings: { value: bindingValue },
    interactiveProps: { options }
  })
}

describe('resolveValueBinding — per-node-type targetType (Phase 3 §3.v4)', () => {
  // ── INPUT: string | number (§3.x baseline, unchanged) ────────────────
  test('INPUT + string docState → controlled OK targetType=string', () => {
    const docs = makeDocStates([
      { id: 'd1', name: 'name', type: 'string', defaultValue: '' }
    ])
    const node = makeNode('INPUT', { kind: 'docState', docStateName: 'name' })
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, new Set(), new Set())
    expect(r).toEqual({
      read: 'name',
      write: { kind: 'docState', name: 'name', targetType: 'string' }
    })
    expect(warnings).toEqual([])
  })

  test('INPUT + number docState → controlled OK targetType=number', () => {
    const docs = makeDocStates([{ id: 'd1', name: 'age', type: 'number', defaultValue: 0 }])
    const node = makeNode('INPUT', { kind: 'docState', docStateName: 'age' })
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, new Set(), new Set())
    expect(r?.write.targetType).toBe('number')
    expect(warnings).toEqual([])
  })

  test('INPUT + boolean docState → warn bad-state-type (unchanged from §3.x)', () => {
    const docs = makeDocStates([
      { id: 'd1', name: 'agreed', type: 'boolean', defaultValue: false }
    ])
    const node = makeNode('INPUT', { kind: 'docState', docStateName: 'agreed' })
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, new Set(), new Set())
    expect(r).toBeNull()
    expect(warnings.some((w) => w.code === 'binding-value-bad-state-type')).toBe(true)
  })

  // ── CHECKBOX / SWITCH: boolean only ─────────────────────────────────
  test('CHECKBOX + boolean docState → controlled OK targetType=boolean', () => {
    const docs = makeDocStates([
      { id: 'd1', name: 'agreed', type: 'boolean', defaultValue: false }
    ])
    const node = makeNode('CHECKBOX', { kind: 'docState', docStateName: 'agreed' })
    const reads = new Set<string>()
    const writes = new Set<string>()
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, reads, writes)
    expect(r).toEqual({
      read: 'agreed',
      write: { kind: 'docState', name: 'agreed', targetType: 'boolean' }
    })
    expect(reads.has('agreed')).toBe(true)
    expect(writes.has('agreed')).toBe(true)
    expect(warnings).toEqual([])
  })

  test('CHECKBOX + string docState → warn bad-state-type', () => {
    const docs = makeDocStates([{ id: 'd1', name: 'name', type: 'string', defaultValue: '' }])
    const node = makeNode('CHECKBOX', { kind: 'docState', docStateName: 'name' })
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, new Set(), new Set())
    expect(r).toBeNull()
    expect(warnings[0]?.code).toBe('binding-value-bad-state-type')
    expect(warnings[0]?.message).toContain('CHECKBOX')
  })

  test('SWITCH + boolean docState → controlled OK targetType=boolean', () => {
    const docs = makeDocStates([
      { id: 'd1', name: 'dark', type: 'boolean', defaultValue: false }
    ])
    const node = makeNode('SWITCH', { kind: 'docState', docStateName: 'dark' })
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, new Set(), new Set())
    expect(r?.write.targetType).toBe('boolean')
    expect(warnings).toEqual([])
  })

  // ── TEXTAREA / SELECT / RADIO / DATEPICKER: string only ─────────────
  test('TEXTAREA + string docState → controlled OK', () => {
    const docs = makeDocStates([{ id: 'd1', name: 'bio', type: 'string', defaultValue: '' }])
    const node = makeNode('TEXTAREA', { kind: 'docState', docStateName: 'bio' })
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, new Set(), new Set())
    expect(r?.write.targetType).toBe('string')
    expect(warnings).toEqual([])
  })

  test('TEXTAREA + number docState → warn bad-state-type (number is INPUT-only)', () => {
    const docs = makeDocStates([{ id: 'd1', name: 'age', type: 'number', defaultValue: 0 }])
    const node = makeNode('TEXTAREA', { kind: 'docState', docStateName: 'age' })
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, new Set(), new Set())
    expect(r).toBeNull()
    expect(warnings[0]?.code).toBe('binding-value-bad-state-type')
  })

  test('SELECT + string docState → controlled OK', () => {
    const docs = makeDocStates([
      { id: 'd1', name: 'country', type: 'string', defaultValue: '' }
    ])
    const node = makeNode('SELECT', { kind: 'docState', docStateName: 'country' })
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, new Set(), new Set())
    expect(r?.write.targetType).toBe('string')
  })

  test('RADIO + string page-state → controlled OK', () => {
    const states = makePageStates([
      { id: 's1', name: 'gender', type: 'string', defaultValue: '' }
    ])
    const node = makeNode('RADIO', { kind: 'ref', stateId: 's1' })
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, states, warnings)
    expect(r).toEqual({
      read: 'gender',
      write: { kind: 'state', name: 'gender', targetType: 'string' }
    })
  })

  test('DATEPICKER + string docState → controlled OK', () => {
    const docs = makeDocStates([{ id: 'd1', name: 'dob', type: 'string', defaultValue: '' }])
    const node = makeNode('DATEPICKER', { kind: 'docState', docStateName: 'dob' })
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, new Set(), new Set())
    expect(r?.write.targetType).toBe('string')
  })

  test('DATEPICKER + boolean docState → warn bad-state-type', () => {
    const docs = makeDocStates([
      { id: 'd1', name: 'agreed', type: 'boolean', defaultValue: false }
    ])
    const node = makeNode('DATEPICKER', { kind: 'docState', docStateName: 'agreed' })
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, new Set(), new Set())
    expect(r).toBeNull()
    expect(warnings[0]?.code).toBe('binding-value-bad-state-type')
  })

  // ── Array/object rejection still works (§3.x baseline) ──────────────
  test('INPUT + array docState → warn bad-state-type', () => {
    const docs = makeDocStates([{ id: 'd1', name: 'items', type: 'array', defaultValue: [] }])
    const node = makeNode('INPUT', { kind: 'docState', docStateName: 'items' })
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, new Set(), new Set())
    expect(r).toBeNull()
    expect(warnings[0]?.code).toBe('binding-value-bad-state-type')
  })

  // ── CHECKBOX group mode (§3.v4 step 8) ──────────────────────────────
  test('CHECKBOX + options[] + array docState → controlled OK targetType=array', () => {
    const docs = makeDocStates([
      { id: 'd1', name: 'fruits', type: 'array', defaultValue: [] }
    ])
    const node = makeNodeWithOptions(
      'CHECKBOX',
      { kind: 'docState', docStateName: 'fruits' },
      ['Apple', 'Banana', 'Cherry']
    )
    const reads = new Set<string>()
    const writes = new Set<string>()
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, reads, writes)
    expect(r).toEqual({
      read: 'fruits',
      write: { kind: 'docState', name: 'fruits', targetType: 'array' }
    })
    expect(reads.has('fruits')).toBe(true)
    expect(writes.has('fruits')).toBe(true)
    expect(warnings).toEqual([])
  })

  test('CHECKBOX + options[] + boolean docState → warn (group mode wants array)', () => {
    const docs = makeDocStates([
      { id: 'd1', name: 'agreed', type: 'boolean', defaultValue: false }
    ])
    const node = makeNodeWithOptions(
      'CHECKBOX',
      { kind: 'docState', docStateName: 'agreed' },
      ['A', 'B']
    )
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, new Set(), new Set())
    expect(r).toBeNull()
    expect(warnings[0]?.code).toBe('binding-value-bad-state-type')
    expect(warnings[0]?.message).toContain('CHECKBOX')
  })

  test('CHECKBOX (single, no options) + array docState → warn (single mode wants boolean)', () => {
    const docs = makeDocStates([{ id: 'd1', name: 'items', type: 'array', defaultValue: [] }])
    const node = makeNode('CHECKBOX', { kind: 'docState', docStateName: 'items' })
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, new Set(), new Set())
    expect(r).toBeNull()
    expect(warnings[0]?.code).toBe('binding-value-bad-state-type')
  })

  test('CHECKBOX + empty options[] → still single mode (boolean)', () => {
    const docs = makeDocStates([
      { id: 'd1', name: 'agreed', type: 'boolean', defaultValue: false }
    ])
    const node = makeNodeWithOptions(
      'CHECKBOX',
      { kind: 'docState', docStateName: 'agreed' },
      []
    )
    const warnings: IRWarning[] = []
    const r = resolveValueBinding(node, new Map(), warnings, docs, new Set(), new Set())
    expect(r?.write.targetType).toBe('boolean')
    expect(warnings).toEqual([])
  })
})
