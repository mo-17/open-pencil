/**
 * Phase 2 §2 step 4 — row-level editing shared by `StatePanel` (page-scoped
 * `state`) and `DocumentStatePanel` (document-scoped `lowcodeDocumentState`).
 *
 * §2.2 #b makes `DocumentStateDef` a `StateDef` alias, so add / rename /
 * retype / default-value editing, JSON-parse error surfacing and name
 * validation are identical for both lists — they live here once so the two
 * panels don't duplicate the logic (jscpd: 0 clones).
 */
import { computed, ref, type ComputedRef } from 'vue'

import { validateStateName } from '@open-pencil/lowcode'
import type { StateDef, StateValueType } from '@open-pencil/scene-graph'

export const STATE_VALUE_TYPES: StateValueType[] = [
  'string',
  'number',
  'boolean',
  'array',
  'object'
]

export interface StateRowEditorOptions {
  /** Current declarations the rows render and mutate. */
  states: ComputedRef<StateDef[]>
  /** Persists the next list (typically via `updateNodeWithUndo`). */
  commit: (next: StateDef[]) => void
  /** Base name for a freshly added row; auto-suffixed on collision. */
  defaultName: string
}

/** Boolean defaults render as a `false` / `true` select; everything else as
 *  a text/number input. Used by both panel templates. */
export function defaultAsString(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'number') return String(value)
  // Remaining StateDef default shapes are strings; anything else is coerced
  // to '' rather than risking an `[object Object]` stringification.
  return typeof value === 'string' ? value : ''
}

function defaultFor(type: StateValueType): unknown {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'array') return []
  if (type === 'object') return {}
  return ''
}

function parseScalar(raw: string, type: StateValueType): unknown {
  if (type === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }
  if (type === 'boolean') return raw === 'true'
  return raw
}

export function useStateRowEditor(options: StateRowEditorOptions) {
  const { states, commit, defaultName } = options

  // Per-row JSON parse errors for array / object defaults. Populated on a
  // failed `@change` and cleared on the next successful commit, so a malformed
  // `[{name:'Alice'}]` (JS literal — invalid JSON) surfaces a red border + 10px
  // error line instead of silently reverting to `[]`.
  const valueErrors = ref<Map<string, string>>(new Map())

  function addState(): void {
    const existing = new Set(states.value.map((s) => s.name))
    let name = defaultName
    let i = 1
    while (existing.has(name)) {
      i++
      name = `${defaultName}${i}`
    }
    const def: StateDef = { id: crypto.randomUUID(), name, type: 'number', defaultValue: 0 }
    commit([...states.value, def])
  }

  function removeState(id: string): void {
    commit(states.value.filter((s) => s.id !== id))
  }

  function renameState(id: string, value: string): void {
    commit(states.value.map((s) => (s.id === id ? { ...s, name: value } : s)))
  }

  function changeType(id: string, type: StateValueType): void {
    commit(
      states.value.map((s) => (s.id === id ? { ...s, type, defaultValue: defaultFor(type) } : s))
    )
  }

  function changeDefault(id: string, rawValue: string, type: StateValueType): void {
    if (type === 'array' || type === 'object') {
      try {
        const parsed = JSON.parse(rawValue)
        const expectedArray = type === 'array'
        if (expectedArray !== Array.isArray(parsed)) {
          valueErrors.value.set(id, `expected a JSON ${type}`)
          return
        }
        valueErrors.value.delete(id)
        commit(states.value.map((s) => (s.id === id ? { ...s, defaultValue: parsed } : s)))
      } catch (err) {
        valueErrors.value.set(id, err instanceof Error ? err.message : String(err))
      }
      return
    }
    valueErrors.value.delete(id)
    commit(
      states.value.map((s) =>
        s.id === id ? { ...s, defaultValue: parseScalar(rawValue, type) } : s
      )
    )
  }

  // Phase 1 §7.3 — mirror what the IR collect pass rejects (`collect/state.ts`)
  // so invalid entries surface inline instead of silently disappearing from the
  // compiled output. Duplicate detection scans in order and flags every
  // occurrence past the first.
  const nameErrors = computed(() => {
    const errors = new Map<string, string>()
    const seen = new Set<string>()
    for (const s of states.value) {
      const result = validateStateName(s.name)
      if (!result.ok) {
        errors.set(s.id, result.reason ?? 'invalid')
        continue
      }
      if (seen.has(s.name)) {
        errors.set(s.id, `duplicate name "${s.name}"`)
        continue
      }
      seen.add(s.name)
    }
    return errors
  })

  return {
    valueErrors,
    nameErrors,
    addState,
    removeState,
    renameState,
    changeType,
    changeDefault
  }
}
