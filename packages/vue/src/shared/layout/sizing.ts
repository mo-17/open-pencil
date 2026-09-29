import { isAutoLayoutMode, type LayoutSizing, type SceneNode } from '@open-pencil/scene-graph'

type Axis = 'width' | 'height'

function ownSizingKey(node: SceneNode, axis: Axis) {
  const horizontal = node.layoutMode === 'HORIZONTAL'
  return (axis === 'width') === horizontal ? 'primaryAxisSizing' : 'counterAxisSizing'
}

function isFlex(node: SceneNode) {
  return node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL'
}

function flowParent(node: SceneNode, parent: SceneNode | null): SceneNode | null {
  return node.layoutPositioning !== 'ABSOLUTE' && parent && isAutoLayoutMode(parent.layoutMode)
    ? parent
    : null
}

function isMainAxis(parent: SceneNode, axis: Axis) {
  return (parent.layoutMode === 'HORIZONTAL') === (axis === 'width')
}

function stretchesCross(node: SceneNode, parent: SceneNode) {
  return (
    node.layoutAlignSelf === 'STRETCH' ||
    (node.layoutAlignSelf === 'AUTO' && parent.counterAxisAlign === 'STRETCH')
  )
}

function gridAxisSizing(node: SceneNode, axis: Axis): LayoutSizing {
  if (node.layoutGrow > 0 || node.layoutAlignSelf === 'STRETCH') return 'FILL'
  if (axis === 'width' && isAutoLayoutMode(node.layoutMode) && node.layoutAlignSelf === 'AUTO') {
    return 'FILL'
  }
  return 'FIXED'
}

/** Effective physical-axis mode, including the parent's flow and inherited alignment. */
export function axisSizingForParent(
  node: SceneNode | null,
  axis: Axis,
  parent: SceneNode | null
): LayoutSizing {
  if (!node) return 'FIXED'
  const flow = flowParent(node, parent)
  if (flow?.layoutMode === 'GRID') return gridAxisSizing(node, axis)
  const own = node[ownSizingKey(node, axis)]
  if (flow) {
    if (isMainAxis(flow, axis) && node.layoutGrow > 0) return 'FILL'
    if (!isMainAxis(flow, axis) && stretchesCross(node, flow)) {
      // An explicit flex dimension wins over align-self, but Hug has no explicit dimension.
      if (!isFlex(node) || own !== 'FIXED') return 'FILL'
    }
    if (
      isFlex(node) &&
      !isMainAxis(flow, axis) &&
      own === 'FILL' &&
      node.layoutAlignSelf !== 'AUTO' &&
      node.layoutAlignSelf !== 'STRETCH'
    )
      return 'HUG'
  }
  if (isFlex(node)) return own
  if (node.layoutMode !== 'GRID' && node.childIds.length > 0 && own === 'HUG') return 'HUG'
  return 'FIXED'
}

function patchGridAxis(node: SceneNode, axis: Axis, sizing: LayoutSizing): Partial<SceneNode> {
  if (sizing === 'FILL') {
    if (gridAxisSizing(node, axis) === 'FILL') return {}
    return { layoutAlignSelf: 'STRETCH' }
  }
  if (gridAxisSizing(node, axis) !== 'FILL') return {}
  // Grid currently shares explicit stretch across both axes. Release the shared mechanism;
  // stored geometry preserves the untouched axis, but its future stretch is not retained.
  const patch: Partial<SceneNode> = { layoutGrow: 0, layoutAlignSelf: 'MIN' }
  const other = axis === 'width' ? 'height' : 'width'
  if (isFlex(node) && gridAxisSizing(node, other) === 'FILL') {
    patch[ownSizingKey(node, other)] = 'FIXED'
  }
  return patch
}

/** Patch only the requested flex axis; Grid's shared stretch follows its existing contract. */
export function axisSizingPatchForParent(
  node: SceneNode,
  axis: Axis,
  sizing: LayoutSizing,
  parent: SceneNode | null
): Partial<SceneNode> {
  const key = ownSizingKey(node, axis)
  const patch: Partial<SceneNode> = {}
  if (isFlex(node)) patch[key] = sizing
  else if (node[key] === 'HUG' || (sizing === 'HUG' && node.childIds.length > 0)) {
    patch[key] = sizing === 'HUG' ? 'HUG' : 'FIXED'
  }

  const flow = flowParent(node, parent)
  if (!flow) return patch
  if (flow.layoutMode === 'GRID') return { ...patch, ...patchGridAxis(node, axis, sizing) }
  if (isMainAxis(flow, axis)) {
    patch.layoutGrow = sizing === 'FILL' ? 1 : 0
  } else if (sizing === 'FILL') {
    patch.layoutAlignSelf = 'STRETCH'
  } else if (stretchesCross(node, flow)) {
    // AUTO would immediately inherit the parent stretch again.
    patch.layoutAlignSelf = 'MIN'
  }
  return patch
}

export function sizingOptionsForParent(
  node: SceneNode | null,
  parent: SceneNode | null,
  labels: Partial<Record<LayoutSizing, string>> = {}
): { value: LayoutSizing; label: string }[] {
  const values: LayoutSizing[] = ['FIXED']
  if (node) {
    const flow = flowParent(node, parent)
    if (flow?.layoutMode !== 'GRID' && node.layoutMode !== 'GRID') {
      if (isFlex(node) || node.childIds.length > 0) values.push('HUG')
    }
    if (flow) values.push('FILL')
  }
  return values.map((value) => ({ value, label: labels[value] ?? value }))
}
