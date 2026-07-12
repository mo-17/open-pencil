import {
  parseExpression,
  PREV_IDENT,
  validateStateName
} from '@open-pencil/core/lowcode-validation'
import type { SceneNode, StateDef } from '@open-pencil/scene-graph'

import type { IRDocStateDecl, IRStateDecl, IRWarning } from '../types'
import { registerDocStateReads, unknownIdentifiers } from './bindings'

/** Hoist page-scoped state declarations into IR. Drops entries with invalid
 *  identifier names so the emitted code stays compilable; the dropped entries
 *  are reported via `invalid` so the adapter can attach warnings.
 *
 *  Validation rules live in `../validate.ts` so the editor UI (StatePanel)
 *  surfaces the same reasons inline — Phase 1 §7.3. Don't fork the regex. */
export function collectPageStates(page: SceneNode | undefined): {
  states: IRStateDecl[]
  invalid: { id: string; name: string; reason: string }[]
} {
  const states: IRStateDecl[] = []
  const invalid: { id: string; name: string; reason: string }[] = []
  if (!page?.state) return { states, invalid }

  const seen = new Set<string>()
  for (const def of page.state) {
    const nameCheck = validateStateName(def.name)
    if (!nameCheck.ok) {
      invalid.push({ id: def.id, name: def.name, reason: nameCheck.reason ?? 'invalid' })
      continue
    }
    if (seen.has(def.name)) {
      invalid.push({ id: def.id, name: def.name, reason: 'duplicate name' })
      continue
    }
    seen.add(def.name)
    states.push(toIRStateDecl(def))
  }
  return { states, invalid }
}

/** Phase 4 §27.2: resolve page-scoped computed state after docState is known.
 *  Computed declarations are read-only, parsed with the normal read-context
 *  expression rules, and emitted after writable state so dependencies are in
 *  scope. Invalid declarations are retained as const default fallbacks, which
 *  preserves downstream bindings while keeping generated code compilable. */
export function resolveComputedStates(
  states: IRStateDecl[],
  warnings: IRWarning[],
  nodeId: string,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  docStateReads: Set<string>
): IRStateDecl[] {
  const byName = new Map(states.map((s) => [s.name, s]))
  for (const state of states) {
    const src = state.computedExpr
    if (typeof src !== 'string') continue
    const trimmed = src.trim()
    if (trimmed === '') {
      markInvalid(
        state,
        warnings,
        nodeId,
        'computed-state-empty',
        `computed state "${state.name}" has an empty computedExpr`
      )
      continue
    }
    const parsed = parseExpression(trimmed)
    if (!parsed.ok) {
      markInvalid(
        state,
        warnings,
        nodeId,
        'computed-state-invalid',
        `computed state "${state.name}" computedExpr "${trimmed}" → ${parsed.error}`
      )
      continue
    }
    if (parsed.references.has(PREV_IDENT)) {
      markInvalid(
        state,
        warnings,
        nodeId,
        'computed-state-prev',
        `computed state "${state.name}" references ${PREV_IDENT}, which is only valid inside setState/setVariable`
      )
      continue
    }
    const unknown = unknownIdentifiers(
      parsed.references,
      indexStatesById(states),
      new Set(),
      docStates
    )
    if (unknown.length > 0) {
      markInvalid(
        state,
        warnings,
        nodeId,
        'computed-state-unknown',
        `computed state "${state.name}" references unknown identifier(s): ${unknown.join(', ')}`
      )
      continue
    }
    registerDocStateReads(parsed.references, docStates, docStateReads)
    state.computed = { ast: parsed.ast, references: [...parsed.references] }
  }
  markComputedCycles(states, byName, warnings, nodeId)
  return orderStates(states, byName)
}

function toIRStateDecl(def: StateDef): IRStateDecl {
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    defaultValue: def.defaultValue,
    computedExpr: def.computedExpr
  }
}

/** Build a lookup from StateDef.id → variable name for fast event/binding
 *  resolution while walking the tree. */
export function indexStatesById(states: IRStateDecl[]): Map<string, IRStateDecl> {
  const map = new Map<string, IRStateDecl>()
  for (const s of states) map.set(s.id, s)
  return map
}

function markInvalid(
  state: IRStateDecl,
  warnings: IRWarning[],
  nodeId: string,
  code: string,
  message: string
): void {
  state.computed = undefined
  state.computedInvalid = true
  warnings.push({ code, message, nodeId })
}

function markComputedCycles(
  states: IRStateDecl[],
  byName: ReadonlyMap<string, IRStateDecl>,
  warnings: IRWarning[],
  nodeId: string
): void {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  for (const state of states) visitCycle(state, byName, visiting, visited, stack, warnings, nodeId)
}

function visitCycle(
  state: IRStateDecl,
  byName: ReadonlyMap<string, IRStateDecl>,
  visiting: Set<string>,
  visited: Set<string>,
  stack: string[],
  warnings: IRWarning[],
  nodeId: string
): void {
  if (!state.computed || state.computedInvalid) return
  if (visited.has(state.name)) return
  if (visiting.has(state.name)) {
    const start = stack.indexOf(state.name)
    const cycle = start !== -1 ? stack.slice(start) : [state.name]
    for (const name of cycle) {
      const cyclic = byName.get(name)
      if (cyclic) {
        cyclic.computed = undefined
        cyclic.computedInvalid = true
      }
    }
    warnings.push({
      code: 'computed-state-cycle',
      message: `computed state cycle detected: ${[...cycle, state.name].join(' -> ')}`,
      nodeId
    })
    return
  }
  visiting.add(state.name)
  stack.push(state.name)
  for (const ref of state.computed.references) {
    const dep = byName.get(ref)
    if (dep?.computed || dep?.computedInvalid) {
      visitCycle(dep, byName, visiting, visited, stack, warnings, nodeId)
    }
  }
  stack.pop()
  visiting.delete(state.name)
  visited.add(state.name)
}

function orderStates(
  states: IRStateDecl[],
  byName: ReadonlyMap<string, IRStateDecl>
): IRStateDecl[] {
  const out: IRStateDecl[] = []
  const emitted = new Set<string>()
  for (const state of states) {
    if (!state.computed) emitState(state, byName, emitted, out)
  }
  for (const state of states) emitState(state, byName, emitted, out)
  return out
}

function emitState(
  state: IRStateDecl,
  byName: ReadonlyMap<string, IRStateDecl>,
  emitted: Set<string>,
  out: IRStateDecl[]
): void {
  if (emitted.has(state.id)) return
  if (state.computed) {
    for (const ref of state.computed.references) {
      const dep = byName.get(ref)
      if (dep?.computed) emitState(dep, byName, emitted, out)
    }
  }
  emitted.add(state.id)
  out.push(state)
}
