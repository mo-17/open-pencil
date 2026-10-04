import {
  templateExpression,
  type VueEmitContext,
  type VueLocalBinding
} from '#compiler/adapters/vue/shared'
import type { IRModule } from '#compiler/ir/types'

import { emitExpression, type ExprAst } from '@open-pencil/lowcode'

function dataBinding(
  module: IRModule | undefined
): { key: 'rows' | 'data'; ast: ExprAst } | undefined {
  if (
    module?.pluginId === 'open-pencil.data-grid' &&
    module.moduleType === 'data-grid' &&
    module.dataGridRowsExpr
  )
    return { key: 'rows', ast: module.dataGridRowsExpr }
  if (
    module?.pluginId === 'open-pencil.chart' &&
    module.moduleType === 'chart' &&
    module.chartDataExpr
  )
    return { key: 'data', ast: module.chartDataExpr }
  return undefined
}

export function reactModuleDataBinding(module: IRModule | undefined): string {
  const binding = dataBinding(module)
  if (!binding) return ''
  return ` ${binding.key}Bound ${binding.key}={(() => { try { return ${emitExpression(binding.ast)} } catch { return undefined } })()}`
}

export function vueModuleDataBinding(
  module: IRModule | undefined,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string[] {
  const binding = dataBinding(module)
  if (!binding) return []
  const read = templateExpression(binding.ast, context.identAliases, locals)
  const expression = `(() => { try { return ${read} } catch { return undefined } })()`
  return [
    `:${binding.key}-bound="true"`,
    `:${binding.key}="${expression.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
  ]
}
