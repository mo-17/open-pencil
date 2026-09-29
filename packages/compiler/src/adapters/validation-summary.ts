import type { ComponentDef, IRNode, IRTree } from '#compiler/ir/types'

export function nodesUseMountedValidationSummary(nodes: readonly IRNode[]): boolean {
  return nodes.some((node) => {
    if (node.kind === 'conditional') return nodesUseMountedValidationSummary([node.consequent])
    if (node.kind === 'list') return nodesUseMountedValidationSummary([node.template])
    if (node.kind !== 'element') return false
    return (
      (node.formValidationMountedOnly === true &&
        node.formValidationSummary !== undefined &&
        (node.formValidationKeys?.length ?? 0) > 0) ||
      nodesUseMountedValidationSummary(node.children)
    )
  })
}

export function projectUsesMountedValidationSummary(
  trees: readonly IRTree[],
  components: readonly ComponentDef[]
): boolean {
  return (
    trees.some((tree) => nodesUseMountedValidationSummary(tree.children)) ||
    components.some(
      (component) =>
        nodesUseMountedValidationSummary(component.children) ||
        component.variants?.some((variant) => nodesUseMountedValidationSummary(variant.children))
    )
  )
}

/** The summary keeps its own anchor even when empty. Observe only that anchor's
 * actual form and publish only changed key sets, so summary updates do not make
 * a MutationObserver feedback loop. Keys are never interpolated into selectors. */
export const MOUNTED_VALIDATION_SUMMARY_OBSERVER = `
function __opObserveMountedValidationKeys(
  anchor: HTMLElement,
  publish: (keys: string[]) => void
): () => void {
  const form = anchor.closest('form')
  if (!form) return () => {}
  let previous: string[] = []
  const update = () => {
    const keys = [...new Set(Array.from(form.querySelectorAll('[data-openpencil-validation-key]'))
      .filter(field => field.closest('form') === form)
      .map(field => field.getAttribute('data-openpencil-validation-key'))
      .filter((key): key is string => key !== null))]
    if (keys.length === previous.length && keys.every((key, index) => key === previous[index])) return
    previous = keys
    publish(keys)
  }
  const observer = new MutationObserver(update)
  observer.observe(form, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-openpencil-validation-key']
  })
  update()
  return () => observer.disconnect()
}
`
