import type { IRTree } from '#compiler/ir/types'

export function applicationSessionPages(irs: readonly IRTree[]) {
  return irs
    .filter((ir) => ir.applicationStateRetention !== undefined)
    .map((ir) => ({
      pageId: ir.pageId,
      retention: ir.applicationStateRetention,
      states: Object.fromEntries(
        ir.states
          .filter((state) => !state.computed && state.computedInvalid !== true)
          .map((state) => [state.name, state.type])
      )
    }))
}

export function hasApplicationPageSessions(irs: readonly IRTree[]): boolean {
  return irs.some((ir) => ir.applicationStateRetention !== undefined)
}
