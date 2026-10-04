import { setterName } from '#compiler/adapters/react/emit/state'
import {
  scriptJSON,
  templateExpression,
  type VueEmitContext,
  type VueLocalBinding
} from '#compiler/adapters/vue/shared'
import type { IRModule } from '#compiler/ir/types'

import { emitExpression } from '@open-pencil/lowcode'

function reviewed(module: IRModule | undefined): boolean {
  return module?.pluginId === 'open-pencil.stepper' && module.moduleType === 'stepper'
}

export function reactStepperBindings(module: IRModule | undefined): string {
  if (!reviewed(module) || !module?.stepper) return ''
  const binding = module.stepper
  const read = ` currentIndexBound currentIndex={(() => { try { return ${emitExpression(binding.currentIndex)} } catch { return undefined } })()}`
  if (!binding.write) return read
  const { kind, name } = binding.write
  const write =
    kind === 'docState'
      ? `setDocState(${JSON.stringify(name)}, value)`
      : `${setterName(name)}(value)`
  return `${read} onStepChange={(value: number) => { ${write} }}`
}

export function vueStepperBindings(
  module: IRModule | undefined,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string[] {
  if (!reviewed(module) || !module?.stepper) return []
  const binding = module.stepper
  const read = templateExpression(binding.currentIndex, context.identAliases, locals)
  const expression = `(() => { try { return ${read} } catch { return undefined } })()`
  const attrs = [
    ':current-index-bound="true"',
    `:current-index="${expression.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
  ]
  if (!binding.write) return attrs
  const { kind, name } = binding.write
  if (kind === 'state' && !context.writableStateNames.has(name)) return attrs
  const write =
    kind === 'docState'
      ? `__setDocState(${scriptJSON(name)}, value)`
      : `${context.writableStateNames.get(name)}.value = value`
  const handler = `__opStepperChange_${++context.eventIndex}`
  context.eventFunctions.push(`function ${handler}(value: number): void { ${write} }`)
  attrs.push(`@step-change="${handler}"`)
  return attrs
}
