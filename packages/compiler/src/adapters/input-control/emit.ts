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

export function reactInputControlImport(nodes: readonly IRNode[], prefix: string): string {
  return hasInputControls(nodes)
    ? `import { OpenPencilInputControl as __OpenPencilInputControl } from '${prefix}_open-pencil-input-control'\n`
    : ''
}

export function vueInputControlImports(nodes: readonly IRNode[], directory: string): string[] {
  return hasInputControls(nodes)
    ? [`import OpInputControl from '${directory}/open-pencil/OpenPencilInputControl.vue'`]
    : []
}
