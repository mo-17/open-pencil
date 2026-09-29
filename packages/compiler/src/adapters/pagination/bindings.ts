import type { IRModule } from '#compiler/ir/types'

import { emitExpression } from '@open-pencil/lowcode'

import { setterName } from '../react/emit/state'
import {
  scriptJSON,
  templateExpression,
  type VueEmitContext,
  type VueLocalBinding
} from '../vue/shared'

function reviewed(module: IRModule | undefined): boolean {
  return module?.pluginId === 'open-pencil.pagination' && module.moduleType === 'pagination'
}

export function reactPaginationBindings(module: IRModule | undefined): string {
  if (!reviewed(module) || !module?.pagination) return ''
  const binding = module.pagination
  const reads = (['currentPage', 'total', 'pageSize'] as const)
    .map((key) => {
      const ast = binding[key]
      return ast
        ? ` ${key}Bound ${key}={(() => { try { return ${emitExpression(ast)} } catch { return undefined } })()}`
        : ''
    })
    .join('')
  if (!binding.write) return reads
  const { name, kind } = binding.write
  const write =
    kind === 'docState'
      ? `setDocState(${JSON.stringify(name)}, value)`
      : `${setterName(name)}(value)`
  return `${reads} onPageChange={(value: number) => { ${write} }}`
}

export function vuePaginationBindings(
  module: IRModule | undefined,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string[] {
  if (!reviewed(module) || !module?.pagination) return []
  const binding = module.pagination
  const attrs = (['currentPage', 'total', 'pageSize'] as const).flatMap((key) => {
    const ast = binding[key]
    if (!ast) return []
    const read = templateExpression(ast, context.identAliases, locals)
    const expression = `(() => { try { return ${read} } catch { return undefined } })()`
    const attr = key.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase())
    return [
      `:${attr}-bound="true"`,
      `:${attr}="${expression.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
    ]
  })
  if (!binding.write) return attrs
  const { name, kind } = binding.write
  const write =
    kind === 'docState'
      ? `__setDocState(${scriptJSON(name)}, value)`
      : `${context.writableStateNames.get(name)}.value = value`
  if (kind === 'state' && !context.writableStateNames.has(name)) return attrs
  const handler = `__opPaginationChange_${++context.eventIndex}`
  context.eventFunctions.push(`function ${handler}(value: number): void { ${write} }`)
  attrs.push(`@page-change="${handler}"`)
  return attrs
}
