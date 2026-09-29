import type { IRAttrValue, IRElement, IRNode } from '#compiler/ir/types'

import { selectTemplateBinding, vueSelectEmptyOptionGuardExpression } from '../select'
import {
  createLocalBinding,
  scopedIdentifier,
  scriptExpression,
  scriptJSON,
  withLocalAliases,
  type VueEmitContext,
  type VueLocalBinding
} from '../shared'

export function nodesUseEnhancedVueSelect(nodes: readonly IRNode[]): boolean {
  return nodes.some((node) => {
    if (node.kind === 'conditional') return nodesUseEnhancedVueSelect([node.consequent])
    if (node.kind === 'list') return nodesUseEnhancedVueSelect([node.template])
    return (
      node.kind === 'element' &&
      ((node.tag === 'select' && node.selectFeatures !== undefined) ||
        nodesUseEnhancedVueSelect(node.children))
    )
  })
}

export function vueSelectImports(nodes: readonly IRNode[], componentDirectory: string): string[] {
  if (!nodesUseEnhancedVueSelect(nodes)) return []
  return [
    `import OpEnhancedSelect from '${componentDirectory}/open-pencil/OpenPencilSelect.vue'`,
    "import { selectOptionText as __opSelectText } from '../lib/open-pencil-select'"
  ]
}

/** Lower option IR directly: no VNode inspection and no hidden full-size option list. */
export function vueSelectOptionsBinding(
  node: IRElement,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string {
  const expression = optionArray(node.children, context, locals)
  return selectTemplateBinding(expression, context, locals)
}

function optionArray(
  nodes: readonly IRNode[],
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string {
  return `[${nodes.map((node) => `...(${optionNode(node, context, locals)})`).join(', ')}]`
}

function optionNode(
  node: IRNode,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string {
  if (node.kind === 'conditional') {
    const condition = scriptExpression(
      node.ast,
      context.refNames,
      withLocalAliases(context.identAliases, locals)
    )
    return `(${condition}) ? ${optionNode(node.consequent, context, locals)} : []`
  }
  if (node.kind === 'list') {
    const item = createLocalBinding(node.itemName, locals.length)
    const index = createLocalBinding(node.indexName, locals.length + 1)
    const array =
      context.listAliases.get(node.arrayName) ??
      scopedIdentifier(node.arrayName, context.identAliases, locals)
    const source = context.refNames.has(array) ? `${array}.value` : array
    return `(${source} ?? []).flatMap((${item.alias}: any, ${index.alias}: number) => ${optionNode(node.template, context, [...locals, item, index])})`
  }
  if (node.kind !== 'element' || node.tag !== 'option') return '[]'
  const label = optionLabel(node.children, context, locals)
  const value = optionAttribute(node.attrs.value, context, locals) ?? label
  const fields = [`value: __opSelectText(${value})`, `label: ${label}`]
  const disabled = optionAttribute(node.attrs.disabled, context, locals)
  if (disabled !== undefined) fields.push(`disabled: Boolean(${disabled})`)
  if ('data-op-select-placeholder' in node.attrs) fields.push('placeholder: true')
  const result = `[{ ${fields.join(', ')} }]`
  const guard = vueSelectEmptyOptionGuardExpression(node, context, locals)
  return guard === undefined ? result : `(${guard}) ? ${result} : []`
}

function optionLabel(
  children: readonly IRNode[],
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string {
  const parts = children.flatMap((child) => {
    // Vue's current i18n contract retains authored fallback copy (and emits a project warning).
    if (child.kind === 'text') return [scriptJSON(child.value)]
    if (child.kind !== 'expression') return []
    const expression = scriptExpression(
      child.ast,
      context.refNames,
      withLocalAliases(context.identAliases, locals)
    )
    return [`__opSelectText(${expression}, ${scriptJSON(child.fallback ?? '')})`]
  })
  return parts.length ? parts.join(' + ') : '""'
}

function optionAttribute(
  value: IRAttrValue | undefined,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object') return scriptJSON(value)
  if (value.kind === 'intlMessage') return scriptJSON(value.defaultMessage)
  if (value.kind !== 'exprAttr') return undefined
  return scriptExpression(
    value.ast,
    context.refNames,
    withLocalAliases(context.identAliases, locals)
  )
}
