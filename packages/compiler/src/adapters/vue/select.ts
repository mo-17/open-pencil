import type { IRElement } from '#compiler/ir/types'

import { collectReferences } from '@open-pencil/lowcode'

import {
  createLocalBinding,
  scopedIdentifier,
  scriptExpression,
  scriptJSON,
  withLocalAliases,
  type VueEmitContext,
  type VueLocalBinding
} from './shared'

export function vueSelectEmptyOptionGuard(
  node: IRElement,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string | undefined {
  const expression = vueSelectEmptyOptionGuardExpression(node, context, locals)
  return expression === undefined ? undefined : selectTemplateBinding(expression, context, locals)
}

export function vueSelectEmptyOptionGuardExpression(
  node: IRElement,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string | undefined {
  const guard = node.selectEmptyOptionGuard
  if (!guard) return undefined
  const array =
    context.listAliases.get(guard.arrayName) ??
    scopedIdentifier(guard.arrayName, context.identAliases, locals)
  const item = createLocalBinding(guard.itemName, locals.length)
  const index = createLocalBinding(guard.indexName, locals.length + 1)
  const expression = scriptExpression(
    guard.value,
    context.refNames,
    withLocalAliases(context.identAliases, [...locals, item, index])
  )
  const arrayExpression = context.refNames.has(array) ? `${array}.value` : array
  const params = collectReferences(guard.value).has(guard.indexName)
    ? `${item.alias}: any, ${index.alias}: number`
    : `${item.alias}: any`
  return `!(${arrayExpression} ?? []).some((${params}) => (${expression}) === "")`
}

/** SELECT defaults must set the DOM value after options mount, not an inert HTML attribute. */
export function vueSelectDefaultValue(
  value: string,
  node: IRElement,
  context: VueEmitContext
): string | undefined {
  // An unmatched HTML/React default falls back to the first available option.
  // Assigning select.value directly would instead clear that legacy selection.
  const staticOptions = node.children.filter(
    (child): child is IRElement => child.kind === 'element' && child.tag === 'option'
  )
  if (!node.selectOptionsSource && !staticOptions.some((option) => option.attrs.value === value))
    return undefined
  const name = `__opSelectDefault_${++context.expressionIndex}`
  context.templateBindings.push(`const ${name} = ${scriptJSON(value)}`)
  return name
}

export function vueSelectOptionValue(
  node: IRElement,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string | undefined {
  const value = node.attrs.value
  if (node.tag !== 'option' || typeof value !== 'object' || value.kind !== 'exprAttr')
    return undefined
  return selectTemplateBinding(
    scriptExpression(value.ast, context.refNames, withLocalAliases(context.identAliases, locals)),
    context,
    locals
  )
}

export function selectTemplateBinding(
  expression: string,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string {
  const name = `__opSelectExpr_${++context.expressionIndex}`
  if (locals.length === 0) {
    context.templateBindings.push(`const ${name} = __vueComputed(() => ${expression})`)
    return name
  }
  const params = locals.map((local) => `${local.alias}: any`).join(', ')
  context.templateBindings.push(`const ${name} = (${params}) => ${expression}`)
  return `${name}(${locals.map((local) => local.alias).join(', ')})`
}
