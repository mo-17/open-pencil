import { isInteractivePropsObject, validateInteractiveProps } from '@open-pencil/lowcode'

export { LOWCODE_INTRINSIC_ELEMENTS, type LowcodeNodeType } from '@open-pencil/design-jsx'
import {
  INTERACTIVE_PROP_NAMES,
  LOWCODE_TYPE_MAP,
  isLowcodeNodeType,
  type LowcodeNodeType,
  type TreeNode
} from '@open-pencil/design-jsx'

export interface PreparedLowcodeProps {
  interactiveProps?: Record<string, unknown>
  warnings: string[]
}

function validateConvenienceProp(elementName: string, key: string, value: unknown): void {
  if (key === 'options') {
    if (!Array.isArray(value) || !value.every((option) => typeof option === 'string')) {
      throw new TypeError(`<${elementName}> options must be an array of strings`)
    }
    return
  }
  if (key === 'checked') {
    if (typeof value !== 'boolean') {
      throw new TypeError(`<${elementName}> checked must be a boolean`)
    }
    return
  }
  if (typeof value !== 'string') {
    throw new TypeError(`<${elementName}> ${key} must be a string`)
  }
}

/**
 * Convert Design JSX's convenient lowcode props into SceneNode fields. The
 * caller merges `interactiveProps` with the type-specific defaults after
 * `createNode`, so an authored subset never removes defaults owned by the
 * scene graph.
 */
export function prepareLowcodeProps(
  nodeType: LowcodeNodeType,
  elementName: string,
  props: Record<string, unknown>,
  buttonText?: string
): PreparedLowcodeProps {
  const rawInteractiveProps = props.interactiveProps
  let hasInteractivePatch = rawInteractiveProps !== undefined

  if (rawInteractiveProps !== undefined && !isInteractivePropsObject(rawInteractiveProps)) {
    throw new Error(`<${elementName}> interactiveProps must be an object`)
  }

  const interactiveProps: Record<string, unknown> = rawInteractiveProps
    ? { ...rawInteractiveProps }
    : {}
  for (const key of INTERACTIVE_PROP_NAMES[nodeType]) {
    if (props[key] === undefined) continue
    validateConvenienceProp(elementName, key, props[key])
    interactiveProps[key] = props[key]
    hasInteractivePatch = true
  }
  if (nodeType === 'BUTTON' && buttonText !== undefined) {
    interactiveProps.text = buttonText
    hasInteractivePatch = true
  }

  const issues = validateInteractiveProps(nodeType, interactiveProps)
  const firstError = issues.find((issue) => issue.severity === 'error')
  if (firstError) throw new Error(`<${elementName}> ${firstError.reason}`)

  return {
    interactiveProps: hasInteractivePatch ? interactiveProps : undefined,
    warnings: issues
      .filter((issue) => issue.severity === 'warning')
      .map((issue) => `<${elementName}> ${issue.reason}`)
  }
}

/** Validate all lowcode controls before rendering any root. */
export async function validateTreeForRenderAsync(
  tree: TreeNode,
  signal?: AbortSignal
): Promise<void> {
  const pending = [tree]
  let work = 0
  while (pending.length) {
    signal?.throwIfAborted()
    const node = pending.pop()
    if (!node) continue
    prepareTreeNodeLowcodeProps(node)
    for (const child of node.children) if (typeof child !== 'string') pending.push(child)
    if (++work % 32 === 0)
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
  }
  signal?.throwIfAborted()
}

export function prepareTreeNodeLowcodeProps(tree: TreeNode) {
  const type = LOWCODE_TYPE_MAP[tree.type.toLowerCase()]
  if (!isLowcodeNodeType(type)) {
    const value = tree.props.interactiveProps
    if (value === undefined) return { props: {}, warnings: [] }
    // Non-control layers also carry compiler layout namespaces through editable JSX.
    if (!isInteractivePropsObject(value))
      throw new TypeError(`<${tree.type}> interactiveProps must be an object`)
    const issues = validateInteractiveProps('FRAME', value)
    const invalid = issues.find((issue) => issue.severity === 'error')
    if (invalid) throw new Error(`<${tree.type}> ${invalid.reason}`)
    return {
      props: { interactiveProps: value },
      warnings: issues.map((issue) => `<${tree.type}> ${issue.reason}`)
    }
  }
  const buttonText =
    type === 'BUTTON' &&
    tree.children.length > 0 &&
    tree.children.every((child) => typeof child === 'string')
      ? tree.children.join('')
      : undefined
  const prepared = prepareLowcodeProps(type, tree.type, tree.props, buttonText)
  return {
    props: prepared.interactiveProps ? { interactiveProps: prepared.interactiveProps } : {},
    warnings: prepared.warnings
  }
}
