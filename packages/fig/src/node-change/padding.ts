import type { SceneNode } from '@open-pencil/scene-graph'

import type { KiwiNodeChange } from './export-node'

function preserveTrailingPadding(
  explicitValue: number | undefined,
  leadingValue: number | undefined,
  baseValue: number | undefined,
  normalizedValue: number
): number | undefined {
  if (explicitValue !== undefined) return explicitValue
  const inheritedValue = leadingValue ?? baseValue ?? normalizedValue
  return normalizedValue !== inheritedValue ? normalizedValue : undefined
}

export function serializeImportedPadding(
  node: SceneNode,
  nc: KiwiNodeChange,
  figLayout: NonNullable<SceneNode['source']['fig']['layout']>
): void {
  // Resolve edited leading padding before trailing omission so changing one
  // side cannot change the other. Untouched native layout remains authoritative.
  const editedFields = node.source.editedFields
  nc.stackPadding = figLayout.stackPadding
  nc.stackVerticalPadding = editedFields.includes('paddingTop')
    ? node.paddingTop
    : figLayout.stackVerticalPadding
  nc.stackHorizontalPadding = editedFields.includes('paddingLeft')
    ? node.paddingLeft
    : figLayout.stackHorizontalPadding
  nc.stackPaddingRight = preserveTrailingPadding(
    editedFields.includes('paddingRight') ? node.paddingRight : figLayout.stackPaddingRight,
    nc.stackHorizontalPadding,
    figLayout.stackPadding,
    node.paddingRight
  )
  nc.stackPaddingBottom = preserveTrailingPadding(
    editedFields.includes('paddingBottom') ? node.paddingBottom : figLayout.stackPaddingBottom,
    nc.stackVerticalPadding,
    figLayout.stackPadding,
    node.paddingBottom
  )
}
