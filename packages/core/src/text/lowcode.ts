import type { SceneNode } from '@open-pencil/scene-graph'

/**
 * Project a lowcode BUTTON label into the regular text model without adding a
 * synthetic child to the scene graph. Keeping this helper in the text domain
 * lets both font preflight and CanvasKit rendering observe the same content.
 */
export function buttonLabelTextNode(node: SceneNode): SceneNode | null {
  const text = node.interactiveProps?.text
  if (node.type !== 'BUTTON' || typeof text !== 'string' || text.length === 0) return null

  return {
    ...node,
    type: 'TEXT',
    childIds: [],
    text,
    textAlignHorizontal: 'CENTER',
    textAlignVertical: 'CENTER',
    textAutoResize: 'NONE',
    textPicture: null,
    figmaDerivedTextGlyphs: null
  }
}
