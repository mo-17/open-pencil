import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { Fill, NodeType, SceneNode, Stroke } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { parseColor } from '#core/color'
import {
  createFigmaProjectionPluginData,
  FIGMA_PROJECTION_VERSION
} from '#core/kiwi/fig/node-change/figma-projection'
import { LOWCODE_NODE_TYPE_KEY } from '#core/kiwi/fig/node-change/lowcode-plugin-data'
import {
  DEFAULT_LOWCODE_PLACEHOLDER_COLOR,
  DEFAULT_LOWCODE_TEXT_COLOR,
  normalizeLowcodeTextColor
} from '#core/lowcode-validation'

export const FIGMA_PROJECTABLE_LOWCODE_TYPES = [
  'BUTTON',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'DATEPICKER',
  'CHECKBOX',
  'RADIO',
  'SWITCH',
  'FORM',
  'LIST'
] as const satisfies readonly NodeType[]

export type FigmaProjectableLowcodeType = (typeof FIGMA_PROJECTABLE_LOWCODE_TYPES)[number]

export type FigmaProjectionRole =
  | 'label'
  | 'value'
  | 'placeholder'
  | 'chevron'
  | 'calendar-icon'
  | 'control'
  | 'indicator'
  | 'track'
  | 'thumb'
  | 'option'
  | 'content'
  | 'empty-state'

export interface FigmaLowcodeProjectionPlan {
  readonly version: typeof FIGMA_PROJECTION_VERSION
  readonly sourceNodeId: string
  readonly sourceNodeType: FigmaProjectableLowcodeType
  /** Native node used at the .fig boundary. It keeps the source id and lowcode side-channel. */
  readonly root: SceneNode
  readonly figmaType: 'FRAME'
  readonly syntheticNodes: readonly SceneNode[]
  readonly allNodes: readonly SceneNode[]
  /**
   * Resolve export children without consulting or mutating the live graph.
   * Pass authored children for the root (FORM/LIST); synthetic parents ignore it.
   */
  childrenFor(
    node: Pick<SceneNode, 'id'>,
    authoredChildren?: readonly SceneNode[]
  ): readonly SceneNode[]
}

const PROJECTABLE_TYPE_SET: ReadonlySet<NodeType> = new Set(FIGMA_PROJECTABLE_LOWCODE_TYPES)

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 }
const INK: Color = { r: 0.12, g: 0.14, b: 0.18, a: 1 }
const MUTED: Color = { r: 0.42, g: 0.45, b: 0.5, a: 1 }
const BORDER: Color = { r: 0.82, g: 0.835, b: 0.859, a: 1 }
const PRIMARY: Color = { r: 0.231, g: 0.51, b: 0.965, a: 1 }

function solid(color: Color): Fill {
  return { type: 'SOLID', color: { ...color }, opacity: 1, visible: true }
}

function stroke(color: Color, weight = 1): Stroke {
  return {
    color: { ...color },
    weight,
    opacity: 1,
    visible: true,
    align: 'INSIDE'
  }
}

function stringProp(node: SceneNode, key: string): string | null {
  const value = node.interactiveProps?.[key]
  return typeof value === 'string' ? value : null
}

function stringOptions(node: SceneNode): string[] {
  const value = node.interactiveProps?.options
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function checked(node: SceneNode): boolean {
  return node.interactiveProps?.checked === true
}

function textControlColor(node: SceneNode, placeholder: boolean): Color {
  return parseColor(
    normalizeLowcodeTextColor(
      node.interactiveProps?.[placeholder ? 'placeholderColor' : 'textColor'],
      placeholder ? DEFAULT_LOWCODE_PLACEHOLDER_COLOR : DEFAULT_LOWCODE_TEXT_COLOR
    )
  )
}

export function isFigmaProjectableLowcodeNode(
  node: SceneNode
): node is SceneNode & { type: FigmaProjectableLowcodeType } {
  return PROJECTABLE_TYPE_SET.has(node.type)
}

/** The native SceneGraph type used for a node in the Figma-compatible projection. */
export function figmaTypeFor(node: Pick<SceneNode, 'type'>): NodeType {
  return PROJECTABLE_TYPE_SET.has(node.type) ? 'FRAME' : node.type
}

function upsertLowcodeNodeType(node: SceneNode, sourceType: FigmaProjectableLowcodeType): void {
  node.pluginData = [
    ...node.pluginData.filter(
      (entry) => !(entry.pluginId === OPEN_PENCIL_PLUGIN_ID && entry.key === LOWCODE_NODE_TYPE_KEY)
    ),
    {
      pluginId: OPEN_PENCIL_PLUGIN_ID,
      key: LOWCODE_NODE_TYPE_KEY,
      value: JSON.stringify(sourceType)
    }
  ]
}

function configureRoot(root: SceneNode): void {
  // Keep every visual and layout property from the source control. Generated
  // children are absolutely positioned so the compatibility view never needs
  // to rewrite OpenPencil-authored root semantics.
  root.type = 'FRAME'
  root.childIds = []
}

interface SyntheticMarker {
  role: FigmaProjectionRole
  field?: string
  index?: number
}

interface ProjectionBuilder {
  add(
    parentId: string,
    type: NodeType,
    marker: SyntheticMarker,
    overrides?: Partial<SceneNode>
  ): SceneNode
  nodes: SceneNode[]
  childrenByParent: Map<string, string[]>
  nodesById: Map<string, SceneNode>
}

function createProjectionBuilder(source: SceneNode): ProjectionBuilder {
  const nodes: SceneNode[] = []
  const childrenByParent = new Map<string, string[]>()
  const nodesById = new Map<string, SceneNode>()
  let sequence = 0

  return {
    nodes,
    childrenByParent,
    nodesById,
    add(parentId, type, marker, overrides = {}) {
      const id = `${source.id}::figma-projection::${sequence++}::${marker.role}`
      const suffix = marker.index === undefined ? '' : ` ${marker.index + 1}`
      const node = createDefaultNode(() => id, type, {
        name: `[OpenPencil] ${marker.role}${suffix}`,
        pluginData: [createFigmaProjectionPluginData(marker)],
        layoutPositioning: parentId === source.id ? 'ABSOLUTE' : 'AUTO',
        ...overrides,
        id,
        type,
        parentId,
        childIds: []
      })
      nodes.push(node)
      nodesById.set(id, node)

      const childIds = childrenByParent.get(parentId) ?? []
      childIds.push(id)
      childrenByParent.set(parentId, childIds)
      const parent = nodesById.get(parentId)
      if (parent) parent.childIds = [...childIds]
      return node
    }
  }
}

function textNode(
  builder: ProjectionBuilder,
  source: SceneNode,
  parentId: string,
  marker: SyntheticMarker,
  text: string,
  options: {
    color?: Color
    width?: number
    height?: number
    align?: 'LEFT' | 'CENTER'
    x?: number
    y?: number
  } = {}
): SceneNode {
  const height = Math.max(
    1,
    options.height ?? Math.min(source.height, Math.max(18, source.fontSize * 1.4))
  )
  return builder.add(parentId, 'TEXT', marker, {
    x: options.x ?? source.paddingLeft,
    y: options.y ?? Math.max(0, (source.height - height) / 2),
    width: Math.max(1, options.width ?? source.width),
    height,
    text,
    fontFamily: source.fontFamily,
    fontSize: source.fontSize,
    lineHeight: source.lineHeight ?? Math.ceil(source.fontSize * 1.2),
    fontWeight: source.fontWeight,
    italic: source.italic,
    textAlignHorizontal: options.align ?? 'LEFT',
    textAlignVertical: 'CENTER',
    textAutoResize: 'NONE',
    fills: [solid(options.color ?? INK)]
  })
}

function availableWidth(source: SceneNode, trailing = 0): number {
  return Math.max(1, source.width - source.paddingLeft - source.paddingRight - trailing)
}

function addButtonProjection(builder: ProjectionBuilder, source: SceneNode): void {
  const authored = stringProp(source, 'text')
  textNode(
    builder,
    source,
    source.id,
    { role: 'label', ...(authored !== null ? { field: 'text' } : {}) },
    authored?.trim() ? authored : 'Button',
    { color: textControlColor(source, false), width: availableWidth(source), align: 'CENTER' }
  )
}

function addTextControlProjection(
  builder: ProjectionBuilder,
  source: SceneNode,
  multiline = false
): void {
  const value = stringProp(source, 'value')
  const placeholder = stringProp(source, 'placeholder')
  const showsValue = value !== null && value !== ''
  const text = showsValue ? value : (placeholder ?? 'Enter text')
  let field: string | undefined
  if (showsValue) field = 'value'
  else if (placeholder !== null) field = 'placeholder'
  textNode(
    builder,
    source,
    source.id,
    { role: showsValue ? 'value' : 'placeholder', ...(field ? { field } : {}) },
    text,
    {
      color: textControlColor(source, !showsValue),
      width: availableWidth(source),
      height: multiline
        ? Math.max(18, source.height - source.paddingTop - source.paddingBottom)
        : undefined,
      y: multiline ? source.paddingTop : undefined
    }
  )
}

function addSelectProjection(builder: ProjectionBuilder, source: SceneNode): void {
  const value = stringProp(source, 'value')
  const options = stringOptions(source)
  const showsValue = value !== null && value !== ''
  const text = showsValue ? value : (options[0] ?? 'Select…')
  let marker: SyntheticMarker = { role: 'placeholder' }
  if (showsValue) marker = { role: 'value', field: 'value' }
  else if (options.length > 0) marker = { role: 'option' }
  textNode(builder, source, source.id, marker, text, {
    color: showsValue || options.length > 0 ? INK : MUTED,
    width: availableWidth(source, 20)
  })
  textNode(builder, source, source.id, { role: 'chevron' }, '⌄', {
    color: MUTED,
    width: 12,
    align: 'CENTER',
    x: Math.max(0, source.width - source.paddingRight - 12)
  })
}

function addDatePickerProjection(builder: ProjectionBuilder, source: SceneNode): void {
  const value = stringProp(source, 'value')
  const hasValue = value !== null && value !== ''
  textNode(
    builder,
    source,
    source.id,
    { role: hasValue ? 'value' : 'placeholder', ...(hasValue ? { field: 'value' } : {}) },
    hasValue ? value : 'YYYY-MM-DD',
    { color: hasValue ? INK : MUTED, width: availableWidth(source, 22) }
  )
  builder.add(
    source.id,
    'RECTANGLE',
    { role: 'calendar-icon' },
    {
      width: 14,
      height: 14,
      x: Math.max(0, source.width - source.paddingRight - 14),
      y: Math.max(0, (source.height - 14) / 2),
      cornerRadius: 2,
      fills: [],
      strokes: [stroke(MUTED, 1)]
    }
  )
}

function addSingleCheckboxProjection(builder: ProjectionBuilder, source: SceneNode): void {
  textNode(builder, source, source.id, { role: 'indicator' }, '✓', {
    color: PRIMARY,
    width: Math.max(1, source.width - 4),
    height: Math.max(1, source.height - 4),
    align: 'CENTER',
    x: 2,
    y: 2
  }).visible = checked(source)
}

function addOptionRow(
  builder: ProjectionBuilder,
  source: SceneNode,
  option: string,
  index: number,
  kind: 'checkbox' | 'radio'
): void {
  const row = builder.add(
    source.id,
    'FRAME',
    { role: 'option', index },
    {
      width: Math.max(1, availableWidth(source)),
      height: 20,
      x: source.paddingLeft,
      y: source.paddingTop + index * 28,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      primaryAxisAlign: 'MIN',
      counterAxisAlign: 'CENTER',
      itemSpacing: 8,
      fills: []
    }
  )
  const selected = kind === 'radio' ? stringProp(source, 'value') === option : checked(source)
  builder.add(
    row.id,
    kind === 'radio' ? 'ELLIPSE' : 'RECTANGLE',
    {
      role: 'indicator',
      index
    },
    {
      width: 16,
      height: 16,
      cornerRadius: kind === 'checkbox' ? 3 : 8,
      fills: [solid(selected ? PRIMARY : WHITE)],
      strokes: [stroke(selected ? PRIMARY : BORDER)]
    }
  )
  textNode(builder, source, row.id, { role: 'label', field: 'options', index }, option, {
    width: Math.max(1, availableWidth(source) - 24),
    height: 20,
    x: 0,
    y: 0
  })
}

function addChoiceProjection(
  builder: ProjectionBuilder,
  source: SceneNode,
  kind: 'checkbox' | 'radio'
): void {
  const options = stringOptions(source)
  if (kind === 'checkbox' && options.length === 0) {
    addSingleCheckboxProjection(builder, source)
    return
  }
  const visibleOptions = options.length > 0 ? options : ['Option']
  for (let index = 0; index < visibleOptions.length; index++) {
    if (options.length > 0) addOptionRow(builder, source, visibleOptions[index], index, kind)
    else {
      const row = builder.add(
        source.id,
        'FRAME',
        { role: 'empty-state', index },
        {
          width: availableWidth(source),
          height: 20,
          x: source.paddingLeft,
          y: source.paddingTop + index * 28,
          layoutMode: 'HORIZONTAL',
          counterAxisAlign: 'CENTER',
          fills: []
        }
      )
      textNode(builder, source, row.id, { role: 'placeholder', index }, visibleOptions[index], {
        color: MUTED,
        width: availableWidth(source),
        height: 20,
        x: 0,
        y: 0
      })
    }
  }
}

function addSwitchProjection(builder: ProjectionBuilder, source: SceneNode): void {
  const thumbSize = Math.max(1, source.height - 4)
  builder.add(
    source.id,
    'RECTANGLE',
    { role: 'track' },
    {
      x: 0,
      y: 0,
      width: source.width,
      height: source.height,
      cornerRadius: source.height / 2,
      fills: [solid(checked(source) ? PRIMARY : BORDER)],
      strokes: []
    }
  )
  builder.add(
    source.id,
    'ELLIPSE',
    { role: 'thumb' },
    {
      x: checked(source) ? Math.max(2, source.width - thumbSize - 2) : 2,
      y: 2,
      width: thumbSize,
      height: thumbSize,
      fills: [solid(WHITE)]
    }
  )
}

function addSyntheticTree(builder: ProjectionBuilder, source: SceneNode): void {
  switch (source.type) {
    case 'BUTTON':
      addButtonProjection(builder, source)
      break
    case 'INPUT':
      addTextControlProjection(builder, source)
      break
    case 'TEXTAREA':
      addTextControlProjection(builder, source, true)
      break
    case 'SELECT':
      addSelectProjection(builder, source)
      break
    case 'DATEPICKER':
      addDatePickerProjection(builder, source)
      break
    case 'CHECKBOX':
      addChoiceProjection(builder, source, 'checkbox')
      break
    case 'RADIO':
      addChoiceProjection(builder, source, 'radio')
      break
    case 'SWITCH':
      addSwitchProjection(builder, source)
      break
    case 'FORM':
    case 'LIST':
      break
  }
}

/**
 * Build an export-only native Figma representation for one lowcode node.
 * The returned nodes are detached deep copies; the source node and live graph
 * remain untouched. Synthetic ids and preorder are deterministic.
 */
export function projectLowcodeNodeForFigma(
  source: SceneNode,
  authoredChildren: readonly SceneNode[] = []
): FigmaLowcodeProjectionPlan | null {
  if (!isFigmaProjectableLowcodeNode(source)) return null

  const root = structuredClone(source)
  const sourceType = source.type
  configureRoot(root)
  upsertLowcodeNodeType(root, sourceType)

  const builder = createProjectionBuilder(source)
  addSyntheticTree(builder, source)
  const directSyntheticIds = builder.childrenByParent.get(source.id) ?? []
  root.childIds = [...authoredChildren.map((child) => child.id), ...directSyntheticIds]

  const syntheticNodes = builder.nodes
  const defaultAuthoredChildren = [...authoredChildren]
  const childrenFor = (
    node: Pick<SceneNode, 'id'>,
    realChildren: readonly SceneNode[] = node.id === root.id ? defaultAuthoredChildren : []
  ): readonly SceneNode[] => {
    const synthetic = (builder.childrenByParent.get(node.id) ?? []).flatMap((id) => {
      const child = builder.nodesById.get(id)
      return child ? [child] : []
    })
    return node.id === root.id ? [...realChildren, ...synthetic] : synthetic
  }

  return {
    version: FIGMA_PROJECTION_VERSION,
    sourceNodeId: source.id,
    sourceNodeType: sourceType,
    root,
    figmaType: 'FRAME',
    syntheticNodes,
    allNodes: [root, ...syntheticNodes],
    childrenFor
  }
}
