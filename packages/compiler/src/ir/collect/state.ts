import type { SceneNode, StateDef } from '@open-pencil/core/scene-graph'

import type { IRStateDecl } from '../types'
import { validateStateName } from '../validate'

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

function toIRStateDecl(def: StateDef): IRStateDecl {
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    defaultValue: def.defaultValue
  }
}

/** Build a lookup from StateDef.id → variable name for fast event/binding
 *  resolution while walking the tree. */
export function indexStatesById(states: IRStateDecl[]): Map<string, IRStateDecl> {
  const map = new Map<string, IRStateDecl>()
  for (const s of states) map.set(s.id, s)
  return map
}
