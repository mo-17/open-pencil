import { BLACK, DEFAULT_FONT_FAMILY, DEFAULT_STROKE_MITER_LIMIT } from '#core/constants'

import type { Color } from '#core/types'

import type { Fill, NodeType, SceneNode, Stroke } from './types'

// Lowcode (Phase 0) visual defaults — make interactive nodes visible on canvas
// without depending on theme tokens. Roughly Tailwind gray-100/300, blue-500.
const LIGHT_GRAY: Color = { r: 0.949, g: 0.949, b: 0.957, a: 1 }
const BORDER_GRAY: Color = { r: 0.82, g: 0.835, b: 0.859, a: 1 }
const PRIMARY_BLUE: Color = { r: 0.231, g: 0.51, b: 0.965, a: 1 }
const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 }

const fillSolid = (color: Color): Fill => ({
  type: 'SOLID',
  color,
  opacity: 1,
  visible: true
})

const strokeSolid = (color: Color, weight = 1): Stroke => ({
  color,
  weight,
  opacity: 1,
  visible: true,
  align: 'INSIDE'
})

export function createDefaultNode(
  generateId: () => string,
  type: NodeType,
  overrides: Partial<SceneNode> = {}
): SceneNode {
  return {
    id: generateId(),
    type,
    name: type.charAt(0) + type.slice(1).toLowerCase(),
    parentId: null,
    childIds: [],
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    figmaDerivedLayout: null,
    fills:
      type === 'TEXT'
        ? [{ type: 'SOLID' as const, color: BLACK, opacity: 1, visible: true }]
        : [],
    strokes: [],
    effects: [],
    opacity: 1,
    cornerRadius: 0,
    topLeftRadius: 0,
    topRightRadius: 0,
    bottomRightRadius: 0,
    bottomLeftRadius: 0,
    independentCorners: false,
    cornerSmoothing: 0,
    visible: true,
    locked: false,
    clipsContent: false,
    text: '',
    fontSize: 14,
    fontFamily: DEFAULT_FONT_FAMILY,
    fontWeight: 400,
    italic: false,
    textAlignHorizontal: 'LEFT',
    textDirection: 'AUTO',
    lineHeight: null,
    letterSpacing: 0,
    layoutMode: 'NONE',
    layoutDirection: 'AUTO',
    layoutWrap: 'NO_WRAP',
    primaryAxisAlign: 'MIN',
    counterAxisAlign: 'MIN',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    itemSpacing: 0,
    counterAxisSpacing: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    blendMode: 'PASS_THROUGH',
    layoutPositioning: 'AUTO',
    layoutGrow: 0,
    layoutAlignSelf: 'AUTO',
    vectorNetwork: null,
    fillGeometry: [],
    strokeGeometry: [],
    arcData: null,
    textAlignVertical: 'TOP',
    textAutoResize: 'NONE',
    textCase: 'ORIGINAL',
    textDecoration: 'NONE',
    maxLines: null,
    styleRuns: [],
    horizontalConstraint: 'MIN',
    verticalConstraint: 'MIN',
    strokeCap: 'NONE',
    strokeJoin: 'MITER',
    dashPattern: [],
    borderTopWeight: 0,
    borderRightWeight: 0,
    borderBottomWeight: 0,
    borderLeftWeight: 0,
    independentStrokeWeights: false,
    strokeMiterLimit: DEFAULT_STROKE_MITER_LIMIT,
    minWidth: null,
    maxWidth: null,
    minHeight: null,
    maxHeight: null,
    isMask: false,
    maskType: 'ALPHA',
    gridTemplateColumns: [],
    gridTemplateRows: [],
    gridColumnGap: 0,
    gridRowGap: 0,
    gridPosition: null,
    counterAxisAlignContent: 'AUTO',
    itemReverseZIndex: false,
    strokesIncludedInLayout: false,
    expanded: true,
    textTruncation: 'DISABLED',
    autoRename: true,
    pointCount: 5,
    starInnerRadius: 0.38,
    componentId: null,
    overrides: {},
    componentPropertyDefinitions: [],
    componentPropertyValues: {},
    componentKey: null,
    sourceLibraryKey: null,
    publishId: null,
    overrideKey: null,
    sharedSymbolVersion: null,
    publishedVersion: null,
    isPublishable: false,
    isSymbolPublishable: false,
    symbolDescription: '',
    symbolLinks: [],
    variantPropSpecs: [],
    boundVariables: {},
    pluginData: [],
    pluginRelaunchData: [],
    internalOnly: false,
    flipX: false,
    flipY: false,
    textPicture: null,
    figmaDerivedTextGlyphs: null,
    ...interactiveDefaults(type),
    ...overrides
  }
}

function interactiveDefaults(type: NodeType): Partial<SceneNode> {
  switch (type) {
    case 'INPUT':
      return {
        width: 200,
        height: 36,
        cornerRadius: 6,
        paddingLeft: 12,
        paddingRight: 12,
        fills: [fillSolid(WHITE)],
        strokes: [strokeSolid(BORDER_GRAY)],
        interactiveProps: { placeholder: 'Enter text', value: '' }
      }
    case 'BUTTON':
      return {
        width: 100,
        height: 36,
        cornerRadius: 6,
        fills: [fillSolid(PRIMARY_BLUE)],
        interactiveProps: { text: 'Button' }
      }
    case 'SELECT':
      return {
        width: 200,
        height: 36,
        cornerRadius: 6,
        paddingLeft: 12,
        paddingRight: 12,
        fills: [fillSolid(WHITE)],
        strokes: [strokeSolid(BORDER_GRAY)],
        interactiveProps: { options: [], value: '' }
      }
    case 'CHECKBOX':
      return {
        width: 20,
        height: 20,
        cornerRadius: 4,
        fills: [fillSolid(WHITE)],
        strokes: [strokeSolid(BORDER_GRAY, 1.5)],
        interactiveProps: { checked: false }
      }
    // Phase 2 §8 — four more interactive components. All emit native HTML.
    case 'RADIO':
      return {
        width: 200,
        height: 96,
        cornerRadius: 6,
        fills: [fillSolid(WHITE)],
        strokes: [strokeSolid(BORDER_GRAY)],
        interactiveProps: { options: [], value: '', groupName: 'radio-group' }
      }
    case 'TEXTAREA':
      return {
        width: 200,
        height: 80,
        cornerRadius: 6,
        paddingLeft: 12,
        paddingRight: 12,
        fills: [fillSolid(WHITE)],
        strokes: [strokeSolid(BORDER_GRAY)],
        interactiveProps: { placeholder: 'Enter text', value: '' }
      }
    case 'DATEPICKER':
      return {
        width: 200,
        height: 36,
        cornerRadius: 6,
        paddingLeft: 12,
        paddingRight: 12,
        fills: [fillSolid(WHITE)],
        strokes: [strokeSolid(BORDER_GRAY)],
        interactiveProps: { value: '' }
      }
    case 'SWITCH':
      return {
        width: 44,
        height: 24,
        cornerRadius: 12,
        fills: [fillSolid(BORDER_GRAY)],
        interactiveProps: { checked: false }
      }
    case 'FORM':
      return {
        width: 320,
        height: 200,
        layoutMode: 'VERTICAL',
        primaryAxisSizing: 'FIXED',
        counterAxisSizing: 'FIXED',
        itemSpacing: 12,
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        cornerRadius: 8,
        fills: [fillSolid(LIGHT_GRAY)]
      }
    case 'LIST':
      return {
        width: 320,
        height: 200,
        layoutMode: 'VERTICAL',
        primaryAxisSizing: 'FIXED',
        counterAxisSizing: 'FIXED',
        itemSpacing: 8,
        cornerRadius: 8,
        fills: [fillSolid(LIGHT_GRAY)],
        clipsContent: true,
        interactiveProps: { dataSourceRef: null }
      }
    default:
      return {}
  }
}

export const CONTAINER_TYPES = new Set<NodeType>([
  'CANVAS',
  'FRAME',
  'GROUP',
  'BOOLEAN_OPERATION',
  'SECTION',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'FORM',
  'LIST'
])
