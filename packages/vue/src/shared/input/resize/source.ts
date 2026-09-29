import type { SceneNode } from '@open-pencil/scene-graph'

import type { DragResize } from '#vue/shared/input/types'

/** Preserve imported payloads, but never export old geometry or sizing over a resize. */
export function resizedSource(
  node: SceneNode,
  before: Readonly<Partial<SceneNode>>,
  originalSizing?: DragResize['originalSizing']
): SceneNode['source'] {
  const rawNodeFields = { ...node.source.fig.rawNodeFields }
  const sizeChanged =
    (before.width !== undefined && before.width !== node.width) ||
    (before.height !== undefined && before.height !== node.height)
  if (sizeChanged) {
    delete rawNodeFields.fillGeometry
    delete rawNodeFields.strokeGeometry
    delete rawNodeFields.strokeWeight
    // TEXT vectorData is the layout path, not a stale baked vector outline.
    if (node.type !== 'TEXT') delete rawNodeFields.vectorData
  }
  const source: SceneNode['source'] = {
    ...node.source,
    fig: {
      ...node.source.fig,
      rawSize: sizeChanged ? null : node.source.fig.rawSize,
      rawTransform: null,
      rawNodeFields
    }
  }
  if (!originalSizing) return source
  const changedKeys = (Object.keys(originalSizing) as (keyof typeof originalSizing)[]).filter(
    (key) => node[key] !== originalSizing[key]
  )
  source.editedFields = [...new Set([...source.editedFields, ...changedKeys])]
  if (source.fig.layout) {
    const layout = { ...source.fig.layout }
    if (changedKeys.includes('primaryAxisSizing'))
      layout.stackPrimarySizing = node.primaryAxisSizing === 'HUG' ? 'RESIZE_TO_FIT' : 'FIXED'
    if (changedKeys.includes('counterAxisSizing'))
      layout.stackCounterSizing = node.counterAxisSizing === 'HUG' ? 'RESIZE_TO_FIT' : 'FIXED'
    if (changedKeys.includes('layoutGrow')) layout.stackChildPrimaryGrow = node.layoutGrow
    if (changedKeys.includes('layoutAlignSelf')) layout.stackChildAlignSelf = node.layoutAlignSelf
    source.fig.layout = layout
  }
  return source
}
