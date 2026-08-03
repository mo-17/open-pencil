import type { SceneNode } from '@open-pencil/scene-graph'

export type LowcodeTextContentKind =
  | 'button_label'
  | 'input_value'
  | 'input_placeholder'
  | 'textarea_value'
  | 'textarea_placeholder'

export interface LowcodeTextProjection {
  node: SceneNode
  contentKind: LowcodeTextContentKind
}

function projectedTextNode(
  node: SceneNode,
  text: string,
  overrides: Partial<SceneNode>
): SceneNode {
  return {
    ...node,
    type: 'TEXT',
    childIds: [],
    text,
    textAutoResize: 'NONE',
    textPicture: null,
    figmaDerivedTextGlyphs: null,
    ...overrides
  }
}

/**
 * Project a lowcode BUTTON label into the regular text model without adding a
 * synthetic child to the scene graph. Keeping this helper in the text domain
 * lets both font preflight and CanvasKit rendering observe the same content.
 */
export function buttonLabelTextNode(node: SceneNode): SceneNode | null {
  const text = node.interactiveProps?.text
  if (node.type !== 'BUTTON' || typeof text !== 'string' || text.length === 0) return null

  return projectedTextNode(node, text, {
    textAlignHorizontal: 'CENTER',
    textAlignVertical: 'CENTER',
    width: node.width,
    height: node.height
  })
}

function textInputProjection(node: SceneNode): LowcodeTextProjection | null {
  if (node.type !== 'INPUT' && node.type !== 'TEXTAREA') return null
  const value = node.interactiveProps?.value
  const placeholder = node.interactiveProps?.placeholder
  const showsValue = typeof value === 'string' && value.length > 0
  let text = ''
  if (showsValue) text = value
  else if (typeof placeholder === 'string') text = placeholder
  const prefix = node.type === 'INPUT' ? 'input' : 'textarea'
  const width = Math.max(1, node.width - node.paddingLeft - node.paddingRight)
  const height =
    node.type === 'TEXTAREA'
      ? Math.max(1, node.height - node.paddingTop - node.paddingBottom)
      : node.height

  return {
    node: projectedTextNode(node, text, {
      width,
      height,
      textAlignVertical: node.type === 'INPUT' ? 'CENTER' : node.textAlignVertical
    }),
    contentKind: `${prefix}_${showsValue ? 'value' : 'placeholder'}` as LowcodeTextContentKind
  }
}

/** Project every lowcode control that owns visible text into the regular text model. */
export function lowcodeTextProjection(node: SceneNode): LowcodeTextProjection | null {
  const button = buttonLabelTextNode(node)
  if (button) return { node: button, contentKind: 'button_label' }
  return textInputProjection(node)
}

export function lowcodeTextNode(node: SceneNode): SceneNode | null {
  return lowcodeTextProjection(node)?.node ?? null
}
