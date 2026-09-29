import type { IRAttrValue, IRElement, IRNode, IRText } from '#compiler/ir/types'

import { collectReferences, emitExpression } from '@open-pencil/lowcode'

/** Keep the collected option contract, but emit data instead of an O(N) VNode tree. */
export function emitEnhancedSelect(node: IRElement, attrs: string, indent: number): string {
  const features = node.selectFeatures
  if (!node.controlled && node.selectDefaultValues)
    attrs += ` defaultValue={${JSON.stringify(node.selectDefaultValues)}}`
  return `${'  '.repeat(indent)}<__OpenPencilSelect ${attrs} options={${optionArray(node.children)}} showSearch={${features?.showSearch === true}} virtual={${features?.virtual === true}} />`
}

function optionArray(nodes: readonly IRNode[]): string {
  return `[${nodes.map((node) => `...${optionNodeArray(node)}`).join(', ')}]`
}

function optionNodeArray(node: IRNode): string {
  if (node.kind === 'conditional')
    return `((${emitExpression(node.ast)}) ? ${optionNodeArray(node.consequent)} : [])`
  if (node.kind === 'list') {
    const body = optionNodeArray(node.template)
    const usesIndex = optionUsesReference(node.template, node.indexName)
    const params = usesIndex ? `${node.itemName}, ${node.indexName}` : node.itemName
    return `(${node.arrayName}).flatMap((${params}) => ${body})`
  }
  if (node.kind !== 'element' || node.tag !== 'option') return '[]'
  const fields = [
    `value: ${attributeString(node.attrs.value)}`,
    `label: ${optionLabel(node.children)}`
  ]
  if ('disabled' in node.attrs)
    fields.push(`disabled: Boolean(${attributeValue(node.attrs.disabled)})`)
  if ('data-op-select-placeholder' in node.attrs) fields.push('placeholder: true')
  const option = `[{ ${fields.join(', ')} }]`
  const guard = node.selectEmptyOptionGuard
  if (!guard) return option
  const params = collectReferences(guard.value).has(guard.indexName)
    ? `${guard.itemName}, ${guard.indexName}`
    : guard.itemName
  return `(!(${guard.arrayName}).some((${params}) => (${emitExpression(guard.value)}) === "") ? ${option} : [])`
}

function optionUsesReference(node: IRNode, name: string): boolean {
  if (node.kind === 'expression') return collectReferences(node.ast).has(name)
  if (node.kind === 'text')
    return node.values?.some((value) => collectReferences(value.ast).has(name)) === true
  if (node.kind === 'conditional')
    return collectReferences(node.ast).has(name) || optionUsesReference(node.consequent, name)
  if (node.kind === 'list')
    return node.arrayName === name || optionUsesReference(node.template, name)
  if (node.kind !== 'element') return false
  return (
    Object.values(node.attrs).some(
      (value) =>
        typeof value === 'object' &&
        value.kind === 'exprAttr' &&
        collectReferences(value.ast).has(name)
    ) || node.children.some((child) => optionUsesReference(child, name))
  )
}

function attributeValue(value: IRAttrValue | undefined): string {
  if (value === undefined) return '""'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (value.kind === 'exprAttr') return emitExpression(value.ast)
  if (value.kind === 'intlMessage')
    return `intl.formatMessage({ id: ${JSON.stringify(value.messageId)}, defaultMessage: ${JSON.stringify(value.defaultMessage)} })`
  return '""'
}

function attributeString(value: IRAttrValue | undefined): string {
  return typeof value === 'string'
    ? JSON.stringify(value)
    : `__opSelectText(${attributeValue(value)})`
}

function optionLabel(nodes: readonly IRNode[]): string {
  const parts = nodes.map((node) => {
    if (node.kind === 'text') return textExpression(node)
    if (node.kind === 'expression')
      return `__opSelectText(${emitExpression(node.ast)}, ${JSON.stringify(node.fallback ?? '')})`
    return '""'
  })
  return parts.length === 0 ? '""' : parts.join(' + ')
}

function textExpression(node: IRText): string {
  if (!node.messageId) return JSON.stringify(node.value)
  const values = node.values?.length
    ? `, { ${node.values.map((value) => `${JSON.stringify(value.name)}: ${emitExpression(value.ast)}`).join(', ')} }`
    : ''
  return `intl.formatMessage({ id: ${JSON.stringify(node.messageId)}, defaultMessage: ${JSON.stringify(node.value)} }${values})`
}

export function hasEnhancedSelect(nodes: readonly IRNode[]): boolean {
  return nodes.some((node) => {
    if (node.kind === 'conditional') return hasEnhancedSelect([node.consequent])
    if (node.kind === 'list') return hasEnhancedSelect([node.template])
    if (node.kind !== 'element') return false
    return node.selectFeatures !== undefined || hasEnhancedSelect(node.children)
  })
}

export function enhancedSelectImport(nodes: readonly IRNode[], prefix: string): string {
  return hasEnhancedSelect(nodes)
    ? `import { OpenPencilSelect as __OpenPencilSelect, selectOptionText as __opSelectText } from '${prefix}_open-pencil-select'\n`
    : ''
}
