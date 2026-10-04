import * as v from 'valibot'

import { validateLowcodeApplication, validateLowcodeApplicationPage } from '@open-pencil/lowcode'
import type { LowcodeApplicationV1, LowcodeApplicationPageV1 } from '@open-pencil/scene-graph'

import { FLUTTER_PREVIEW_SNAPSHOT_LIMITS as LIMITS } from './limits'

const id = v.pipe(v.string(), v.minLength(1), v.maxLength(256))
const finite = v.pipe(v.number(), v.finite())
const record = v.record(v.string(), v.unknown())
const records = v.array(record)
const nullableString = v.nullable(v.string())
const nullableNumber = v.nullable(finite)
const color = v.strictObject({ r: finite, g: finite, b: finite, a: finite })
const vector = v.strictObject({ x: finite, y: finite })
const fill = v.looseObject({
  type: v.picklist([
    'SOLID',
    'GRADIENT_LINEAR',
    'GRADIENT_RADIAL',
    'GRADIENT_ANGULAR',
    'GRADIENT_DIAMOND',
    'IMAGE',
    'VIDEO',
    'PATTERN',
    'NOISE',
    'CUSTOM'
  ]),
  color,
  opacity: finite,
  visible: v.boolean(),
  gradientStops: v.optional(v.array(v.looseObject({ position: finite, color })))
})
const stroke = v.looseObject({
  color,
  weight: finite,
  opacity: finite,
  visible: v.boolean(),
  align: v.picklist(['INSIDE', 'CENTER', 'OUTSIDE'])
})
const effect = v.looseObject({
  type: v.picklist([
    'DROP_SHADOW',
    'INNER_SHADOW',
    'LAYER_BLUR',
    'BACKGROUND_BLUR',
    'FOREGROUND_BLUR'
  ]),
  color,
  offset: vector,
  radius: finite,
  spread: finite,
  visible: v.boolean()
})
const network = v.looseObject({
  vertices: v.array(v.looseObject({ x: finite, y: finite })),
  segments: v.array(
    v.looseObject({
      start: v.pipe(finite, v.integer(), v.minValue(0)),
      end: v.pipe(finite, v.integer(), v.minValue(0)),
      tangentStart: vector,
      tangentEnd: vector
    })
  ),
  regions: v.array(
    v.looseObject({
      windingRule: v.picklist(['NONZERO', 'EVENODD']),
      loops: v.array(v.array(v.pipe(finite, v.integer(), v.minValue(0))))
    })
  )
})

// Every required SceneNode field has a shape guard; optional behavior stays bounded data
// and is accepted or rejected by the compiler's existing target-specific validators.
const nodeTypes = [
  'CANVAS',
  'FRAME',
  'RECTANGLE',
  'ROUNDED_RECTANGLE',
  'ELLIPSE',
  'TEXT',
  'LINE',
  'STAR',
  'POLYGON',
  'VECTOR',
  'BOOLEAN_OPERATION',
  'GROUP',
  'SECTION',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'CONNECTOR',
  'SHAPE_WITH_TEXT',
  'INPUT',
  'BUTTON',
  'SELECT',
  'CHECKBOX',
  'FORM',
  'LIST',
  'RADIO',
  'TEXTAREA',
  'DATEPICKER',
  'SWITCH'
] as const
const blob = v.pipe(
  v.array(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(255))),
  v.maxLength(LIMITS.maxBinaryBytes)
)
const geometry = v.array(
  v.looseObject({
    windingRule: v.picklist(['NONZERO', 'EVENODD']),
    commandsBlob: blob,
    fills: v.optional(v.array(fill))
  })
)
const overrideValue = v.variant('defined', [
  v.strictObject({ defined: v.literal(false) }),
  v.strictObject({ defined: v.literal(true), value: v.nonOptional(v.unknown()) })
])
const overrideEntries = v.array(v.tuple([id, overrideValue]))
export const flutterPreviewNodeSchema = v.looseObject({
  id,
  type: v.picklist(nodeTypes),
  name: v.string(),
  parentId: v.nullable(id),
  childIds: v.array(id),
  x: finite,
  y: finite,
  width: finite,
  height: finite,
  rotation: finite,
  visible: v.boolean(),
  locked: v.boolean(),
  opacity: finite,
  fills: v.array(fill),
  strokes: v.array(stroke),
  effects: v.array(effect),
  text: v.string(),
  fontSize: finite,
  fontFamily: v.string(),
  fontWeight: finite,
  styleRuns: v.array(
    v.looseObject({
      start: v.pipe(finite, v.integer(), v.minValue(0)),
      length: v.pipe(finite, v.integer(), v.minValue(0)),
      style: record
    })
  ),
  fillGeometry: geometry,
  strokeGeometry: geometry,
  textPicture: v.nullable(blob),
  componentId: v.nullable(id),
  boundVariables: v.record(v.string(), id),
  variableModes: v.record(v.string(), id),
  source: v.looseObject({
    format: v.nullable(v.literal('fig')),
    id: v.nullable(v.string()),
    orderKey: v.nullable(v.string()),
    editedFields: v.array(v.string()),
    fig: v.looseObject({
      rawNodeType: nullableString,
      rawStructuralFieldPresence: v.nullable(
        v.strictObject({
          name: v.boolean(),
          visible: v.boolean(),
          opacity: v.boolean(),
          size: v.boolean(),
          transform: v.boolean(),
          frameMaskDisabled: v.boolean()
        })
      ),
      rawSize: v.nullable(v.strictObject({ x: finite, y: finite })),
      rawTransform: v.nullable(
        v.strictObject({
          m00: finite,
          m01: finite,
          m02: finite,
          m10: finite,
          m11: finite,
          m12: finite
        })
      ),
      rawNodeFields: record,
      layout: v.nullable(record),
      symbolOverrides: v.array(v.unknown()),
      componentPropAssignments: v.array(v.unknown()),
      derivedSymbolData: v.array(v.unknown()),
      derivedSymbolDataLayoutVersion: nullableNumber,
      uniformScaleFactor: nullableNumber
    })
  }),
  derivedLayout: v.nullable(record),
  layoutGrids: records,
  guides: records,
  fillStyleId: nullableString,
  strokeStyleId: nullableString,
  textStyleId: nullableString,
  effectStyleId: nullableString,
  gridStyleId: nullableString,
  sharedStyleType: nullableString,
  cornerRadius: finite,
  topLeftRadius: finite,
  topRightRadius: finite,
  bottomRightRadius: finite,
  bottomLeftRadius: finite,
  independentCorners: v.boolean(),
  cornerSmoothing: finite,
  clipsContent: v.boolean(),
  blendMode: v.string(),
  italic: v.boolean(),
  textAlignHorizontal: v.picklist(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']),
  textDirection: v.picklist(['AUTO', 'LTR', 'RTL']),
  textLanguage: nullableString,
  textAlignVertical: v.string(),
  textAutoResize: v.string(),
  textCase: v.string(),
  textDecoration: v.string(),
  textDecorationStyle: v.string(),
  textDecorationThickness: nullableNumber,
  textDecorationFills: v.array(fill),
  textDecorationSkipInk: v.boolean(),
  textUnderlineOffset: nullableNumber,
  leadingTrim: v.string(),
  lineHeight: nullableNumber,
  letterSpacing: finite,
  maxLines: nullableNumber,
  fontVariations: records,
  fontFeatures: records,
  horizontalConstraint: v.string(),
  verticalConstraint: v.string(),
  layoutMode: v.picklist(['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID', 'FREE']),
  layoutDirection: v.picklist(['AUTO', 'LTR', 'RTL']),
  layoutWrap: v.string(),
  primaryAxisAlign: v.string(),
  counterAxisAlign: v.string(),
  primaryAxisSizing: v.string(),
  counterAxisSizing: v.string(),
  itemSpacing: finite,
  counterAxisSpacing: finite,
  paddingTop: finite,
  paddingRight: finite,
  paddingBottom: finite,
  paddingLeft: finite,
  layoutPositioning: v.picklist(['AUTO', 'ABSOLUTE']),
  layoutGrow: finite,
  layoutAlignSelf: v.string(),
  vectorNetwork: v.nullable(network),
  handleMirroring: v.string(),
  arcData: v.nullable(
    v.strictObject({ startingAngle: finite, endingAngle: finite, innerRadius: finite })
  ),
  strokeCap: v.string(),
  strokeJoin: v.string(),
  dashPattern: v.array(finite),
  borderTopWeight: finite,
  borderRightWeight: finite,
  borderBottomWeight: finite,
  borderLeftWeight: finite,
  independentStrokeWeights: v.boolean(),
  strokeMiterLimit: finite,
  minWidth: nullableNumber,
  maxWidth: nullableNumber,
  minHeight: nullableNumber,
  maxHeight: nullableNumber,
  isMask: v.boolean(),
  maskType: v.string(),
  maskIsOutline: v.boolean(),
  gridTemplateColumns: records,
  gridTemplateRows: records,
  gridColumnGap: finite,
  gridRowGap: finite,
  gridPosition: v.nullable(
    v.strictObject({ column: finite, row: finite, columnSpan: finite, rowSpan: finite })
  ),
  counterAxisAlignContent: v.string(),
  itemReverseZIndex: v.boolean(),
  strokesIncludedInLayout: v.boolean(),
  expanded: v.boolean(),
  textTruncation: v.string(),
  autoRename: v.boolean(),
  pointCount: finite,
  starInnerRadius: finite,
  overrides: record,
  componentPropertyDefinitions: records,
  componentPropertyReferences: records,
  componentPropertyAssignments: v.record(v.string(), v.string()),
  componentPropertyValues: v.record(v.string(), v.string()),
  componentKey: nullableString,
  sourceLibraryKey: nullableString,
  publishId: nullableString,
  overrideKey: nullableString,
  sharedSymbolVersion: nullableString,
  publishedVersion: nullableString,
  librarySource: v.nullable(record),
  isPublishable: v.boolean(),
  isSymbolPublishable: v.boolean(),
  symbolDescription: v.string(),
  symbolLinks: records,
  variantPropSpecs: records,
  exportSettings: records,
  pluginData: v.array(v.looseObject({ pluginId: v.string(), key: v.string(), value: v.string() })),
  lowcodeApplication: v.optional(
    v.custom<LowcodeApplicationV1>((value) => validateLowcodeApplication(value).ok)
  ),
  lowcodeApplicationPage: v.optional(
    v.custom<LowcodeApplicationPageV1>((value) => validateLowcodeApplicationPage(value).ok)
  ),
  pluginRelaunchData: v.array(
    v.looseObject({
      pluginId: v.string(),
      command: v.string(),
      message: v.string(),
      isDeleted: v.boolean()
    })
  ),
  internalOnly: v.boolean(),
  flipX: v.boolean(),
  flipY: v.boolean(),
  derivedTextGlyphs: v.nullable(
    v.array(
      v.looseObject({
        commandsBlob: blob,
        x: finite,
        y: finite,
        fontSize: finite,
        rotation: v.optional(finite),
        scaleX: v.optional(finite),
        scaleY: v.optional(finite)
      })
    )
  ),
  textPathData: v.nullable(
    v.looseObject({ network, normalizedSize: vector, tValue: finite, forward: v.boolean() })
  ),
  textPathBox: v.nullable(v.strictObject({ x: finite, y: finite, width: finite, height: finite })),
  instanceOverrides: v.strictObject({
    self: overrideEntries,
    descendants: v.array(v.tuple([id, overrideEntries]))
  })
})
