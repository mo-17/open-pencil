import type { IRNode } from '#compiler/ir/types'

export function hasInputControls(nodes: readonly IRNode[]): boolean {
  return nodes.some((node) => {
    if (node.kind === 'conditional') return hasInputControls([node.consequent])
    if (node.kind === 'list') return hasInputControls([node.template])
    return (
      node.kind === 'element' &&
      (node.inputControl !== undefined || hasInputControls(node.children))
    )
  })
}

export function hasNumericInputBindings(nodes: readonly IRNode[]): boolean {
  return nodes.some((node) => {
    if (node.kind === 'conditional') return hasNumericInputBindings([node.consequent])
    if (node.kind === 'list') return hasNumericInputBindings([node.template])
    return (
      node.kind === 'element' &&
      ((node.tag === 'input' && node.controlled?.write.targetType === 'number') ||
        hasNumericInputBindings(node.children))
    )
  })
}

export function hasNativeNumericInputBindings(nodes: readonly IRNode[]): boolean {
  return nodes.some((node) => {
    if (node.kind === 'conditional') return hasNativeNumericInputBindings([node.consequent])
    if (node.kind === 'list') return hasNativeNumericInputBindings([node.template])
    return (
      node.kind === 'element' &&
      ((node.tag === 'input' &&
        node.controlled?.write.targetType === 'number' &&
        node.inputControl === undefined) ||
        hasNativeNumericInputBindings(node.children))
    )
  })
}

export function reactInputControlImport(nodes: readonly IRNode[], prefix: string): string {
  return hasInputControls(nodes)
    ? `import { OpenPencilInputControl as __OpenPencilInputControl } from '${prefix}_open-pencil-input-control'\n`
    : ''
}

export function reactNumberInputImport(nodes: readonly IRNode[], prefix: string): string {
  return hasNativeNumericInputBindings(nodes)
    ? `import { OpenPencilNumberInput as __OpenPencilNumberInput } from '${prefix}_open-pencil-number-input'\n`
    : ''
}

export function reactNumberParserImport(nodes: readonly IRNode[], prefix: string): string {
  return hasNumericInputBindings(nodes)
    ? `import { parseNumericDraft as __opParseNumericDraft } from '${prefix}open-pencil-number-draft'\n`
    : ''
}

export function vueInputControlImports(nodes: readonly IRNode[], directory: string): string[] {
  return hasInputControls(nodes)
    ? [`import OpInputControl from '${directory}/open-pencil/OpenPencilInputControl.vue'`]
    : []
}

export function vueNumberInputImports(nodes: readonly IRNode[], directory: string): string[] {
  return hasNativeNumericInputBindings(nodes)
    ? [`import OpNumberInput from '${directory}/open-pencil/OpenPencilNumberInput.vue'`]
    : []
}

export function vueNumberParserImports(nodes: readonly IRNode[], directory: string): string[] {
  return hasNumericInputBindings(nodes)
    ? [
        `import { parseNumericDraft as __opParseNumericDraft } from '${directory}/open-pencil-number-draft'`
      ]
    : []
}
