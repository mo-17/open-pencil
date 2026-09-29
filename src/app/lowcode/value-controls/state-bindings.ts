import type { LowcodeSelectOption } from '@open-pencil/lowcode'
import type { BindingExpr } from '@open-pencil/scene-graph'

/** Project only a declared state choice; callers own unbound and expression modes. */
export function stateBindingSelection(
  binding: BindingExpr,
  options: readonly Pick<LowcodeSelectOption, 'value'>[]
): string {
  let value = ''
  if (binding.kind === 'ref') value = `state:${binding.stateId}`
  if (binding.kind === 'docState') value = `doc:${binding.docStateName}`
  return options.some((option) => option.value === value) ? value : 'invalid'
}
