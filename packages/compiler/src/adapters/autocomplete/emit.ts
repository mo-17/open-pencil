import type { IRNode } from '#compiler/ir/types'

export function hasInputSuggestions(nodes: readonly IRNode[]): boolean {
  return nodes.some((node) => {
    if (node.kind === 'conditional') return hasInputSuggestions([node.consequent])
    if (node.kind === 'list') return hasInputSuggestions([node.template])
    return (
      node.kind === 'element' &&
      (node.inputSuggestions !== undefined || hasInputSuggestions(node.children))
    )
  })
}

export function reactAutocompleteImport(nodes: readonly IRNode[], prefix: string): string {
  return hasInputSuggestions(nodes)
    ? `import { OpenPencilAutocomplete as __OpenPencilAutocomplete } from '${prefix}_open-pencil-autocomplete'\n`
    : ''
}

export function vueAutocompleteImports(nodes: readonly IRNode[], directory: string): string[] {
  return hasInputSuggestions(nodes)
    ? [`import OpAutocomplete from '${directory}/open-pencil/OpenPencilAutocomplete.vue'`]
    : []
}
