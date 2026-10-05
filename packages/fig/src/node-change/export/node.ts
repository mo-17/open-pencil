import type { DerivedSymbolOverride } from '#fig/instance-overrides/types'
import {
  effectiveFigmaRawNodeFields,
  effectiveFigmaSourcePayload,
  staleFigmaRawFields
} from '#fig/source-metadata'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { stringToGuid } from '@open-pencil/kiwi/fig/guid'
import type {
  ComponentPropertyDefinition,
  ComponentPropertyReferenceField,
  PluginDataEntry,
  SceneGraph,
  SceneNode
} from '@open-pencil/scene-graph'
import { DEFAULT_STROKE_MITER_LIMIT } from '@open-pencil/scene-graph'
import type { GUID, Matrix, Vector } from '@open-pencil/scene-graph/primitives'

/* eslint-disable max-lines */
import { siblingOrderKeys } from '../basics'
import { bytesToHex } from '../bytes'
import { exportCanvasGuides } from '../canvas-guides'
import { snapshotInstanceGeometry } from '../instance/geometry'
import { applyLayoutPreferences } from '../layout-preferences'
import {
  applyExportSettingsPluginData,
  applyLibrarySourcePluginData,
  applyTextPathBoxPluginData,
  mergePluginData,
  NODE_TYPE_PLUGIN_KEY,
  serializePluginRelaunchData,
  upsertPluginData
} from '../plugin-data'
import {
  componentPropertyValue,
  componentPropertyVariableValue,
  serializeComponentPropertyAssignments
} from './component-values'
import {
  applyColorVariableBinding,
  createFillPaints,
  createStrokePaints,
  getOrCreateNodeGuid,
  instanceGuidResolver,
  getOrCreatePropertyGuid,
  parseGuidOrNull,
  resolveInstanceComponentId,
  type KiwiNodeChange,
  type KiwiSymbolOverridePayload,
  type SceneNodeToKiwiContext
} from './context'
import { mergeOverrides, serializeRuntimePropertyOverrides } from './override-claims'
import { nodeWithResolvedBindings } from './resolved-bindings'
import { slotDefinitionFields } from './slots'

export type { KiwiNodeChange, SceneNodeToKiwiContext } from './context'

const siblingOrderKeyCache = new WeakMap<object, Map<string, { keyById: Map<string, string> }>>()

/**
 * A layer's `parentIndex.position`: its imported key where that still orders it after the
 * previous sibling, otherwise a key between its neighbours, so a round trip keeps the keys
 * Figma wrote instead of renumbering every sibling.
 *
 * Canvas layers and shared styles use the same sibling keys; resource-only records
 * are allocated after these keys by the document writer.
 */
function exportOrderKey(
  context: SceneNodeToKiwiContext,
  node: SceneNode,
  childIndex: number
): string {
  const parentId = node.parentId
  if (!parentId) return context.fractionalPosition(childIndex)
  const parent = context.graph.getNode(parentId)
  if (!parent) return context.fractionalPosition(childIndex)
  let cache = context.siblingOrderKeys ?? siblingOrderKeyCache.get(context)
  if (!cache) {
    cache = new Map()
    siblingOrderKeyCache.set(context, cache)
  }
  let entry = cache.get(parentId)
  if (!entry) {
    const siblings = context.graph
      .getChildren(parentId)
      .filter((child) => !child.internalOnly || child.sharedStyleType !== null)
    const keys = siblingOrderKeys(
      siblings.map((sibling) => (sibling.source.format === 'fig' ? sibling.source.orderKey : null))
    )
    // Keyed by id: this runs once per child, so a scan per child would cost the parent O(n²).
    entry = { keyById: new Map(siblings.map((sibling, index) => [sibling.id, keys[index]])) }
    cache.set(parentId, entry)
  }
  return entry.keyById.get(node.id) ?? context.fractionalPosition(childIndex)
}

const OPAQUE_STRUCTURAL_FIELD_EDIT_KEYS = {
  name: ['name'],
  visible: ['visible'],
  opacity: ['opacity'],
  size: ['width', 'height'],
  transform: ['x', 'y', 'rotation', 'flipX', 'flipY'],
  frameMaskDisabled: ['clipsContent']
} as const

type OpaqueStructuralField = keyof typeof OPAQUE_STRUCTURAL_FIELD_EDIT_KEYS

function deleteOpaqueStructuralField(
  nodeChange: KiwiNodeChange,
  field: OpaqueStructuralField
): void {
  switch (field) {
    case 'name':
      delete nodeChange.name
      break
    case 'visible':
      delete nodeChange.visible
      break
    case 'opacity':
      delete nodeChange.opacity
      break
    case 'size':
      delete nodeChange.size
      break
    case 'transform':
      delete nodeChange.transform
      break
    case 'frameMaskDisabled':
      delete nodeChange.frameMaskDisabled
      break
  }
}

type KiwiBooleanOperation = NonNullable<NodeChange['booleanOperation']>

function toKiwiBooleanOperation(operation: SceneNode['booleanOperation']): KiwiBooleanOperation {
  return operation === 'EXCLUDE' ? 'XOR' : (operation ?? 'UNION')
}

/** Resolve effect variable asset refs when the Kiwi effect schema requires GUID aliases. */
export function buildAssetRefToVarGuidMap(
  graph: SceneGraph,
  varIdToGuid: Map<string, GUID>
): Map<string, GUID> {
  const map = new Map<string, GUID>()
  for (const [varId, variable] of graph.variables) {
    if (!variable.key) continue
    const guid = varIdToGuid.get(varId) ?? stringToGuid(varId)
    map.set(variable.key, guid)
    if (variable.version) map.set(`${variable.key}@${variable.version}`, guid)
  }
  return map
}

function componentPropertyTypeForKiwi(type: string) {
  if (type === 'BOOLEAN') return 'BOOL'
  return type
}

function serializeVariableModes(
  node: SceneNode,
  variableIdToGuid?: Map<string, GUID>,
  modeIdToGuid?: Map<string, GUID>
): NonNullable<KiwiNodeChange['variableModeBySetMap']> | undefined {
  const entries = Object.entries(node.variableModes).flatMap(([collectionId, modeId]) => {
    const collectionGuid = variableIdToGuid?.get(collectionId) ?? parseGuidOrNull(collectionId)
    const modeGuid = modeIdToGuid?.get(modeId) ?? parseGuidOrNull(modeId)
    if (!collectionGuid || !modeGuid) return []
    return [{ variableSetID: { guid: collectionGuid }, variableModeID: modeGuid }]
  })
  return entries.length > 0 ? { entries } : undefined
}

const FIGMA_PAYLOAD_VARIABLE_MAP_FIELDS = new Set([
  'variableConsumptionMap',
  'parameterConsumptionMap'
])
const FIGMA_PAYLOAD_PAINT_VARIABLE_FIELDS = new Set([
  'colorVar',
  'colorVariableBinding',
  'opacityVar'
])

const SUPPORTED_VARIABLE_DATA_TYPES = new Set([
  'BOOLEAN',
  'FLOAT',
  'STRING',
  'ALIAS',
  'COLOR',
  'SYMBOL_ID',
  'TEXT_DATA',
  'PROP_REF'
])

interface FigmaPayloadVariableMap {
  entries?: unknown[]
}

interface FigmaPayloadVariableMapEntry {
  variableData?: { dataType?: string; value?: { propRefValue?: unknown } }
}

interface ColorVarCarrier {
  colorVar?: {
    value?: {
      alias?: {
        guid?: GUID
        assetRef?: { key: string; version?: string }
      }
    }
  }
  stopsVar?: ColorVarCarrier[]
}

function isFigmaPayloadVariableMap(value: unknown): value is FigmaPayloadVariableMap {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'entries' in value
}

function isFigmaPayloadVariableMapEntry(value: unknown): value is FigmaPayloadVariableMapEntry {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isSupportedVariableMapEntry(value: unknown): boolean {
  if (!isFigmaPayloadVariableMapEntry(value)) return false
  const entry = value
  const dataType = entry.variableData?.dataType
  return (
    (typeof dataType === 'string' && SUPPORTED_VARIABLE_DATA_TYPES.has(dataType)) ||
    !!entry.variableData?.value?.propRefValue
  )
}

function isPropRefVariableMapEntry(value: unknown): boolean {
  if (!isFigmaPayloadVariableMapEntry(value)) return false
  const entry = value
  return entry.variableData?.dataType === 'PROP_REF' || !!entry.variableData?.value?.propRefValue
}

function materializeSafeVariableMap(
  value: unknown,
  blobs: Uint8Array[],
  options: MaterializeFigmaPayloadOptions,
  predicate: (value: unknown) => boolean
): unknown {
  if (!isFigmaPayloadVariableMap(value)) return undefined
  const entries = value.entries?.filter(predicate) ?? []
  if (entries.length === 0) return undefined
  return { entries: entries.map((entry) => materializeFigmaPayload(entry, blobs, options)) }
}

export interface MaterializeFigmaPayloadOptions {
  blobIndexByHex?: Map<string, number>
  includePaintVariables?: boolean
  includeVariableMaps?: boolean
}

function materializeFigmaBlob(
  value: { __openPencilFigmaBlob?: Uint8Array | Record<string, number> },
  blobs: Uint8Array[],
  options: MaterializeFigmaPayloadOptions
): number {
  const blob = value.__openPencilFigmaBlob
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(Object.values(blob ?? {}))
  const key = bytesToHex(bytes)
  const existing = options.blobIndexByHex?.get(key)
  if (existing !== undefined) return existing
  const index = blobs.length
  blobs.push(bytes)
  options.blobIndexByHex?.set(key, index)
  return index
}

function normalizeFigmaPayloadValue(key: string, value: unknown): unknown {
  if (key === 'stackCounterAlignItems' && value === 'STRETCH') return 'MIN'
  if (
    (key === 'stackJustify' ||
      key === 'stackPrimaryAlignItems' ||
      key === 'stackCounterAlign' ||
      key === 'stackCounterAlignItems') &&
    value === 'SPACE_EVENLY'
  ) {
    return 'SPACE_BETWEEN'
  }
  return value
}

export function materializeFigmaPayload(
  value: unknown,
  blobs: Uint8Array[],
  options: MaterializeFigmaPayloadOptions = {}
): unknown {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value))
    return value.map((item) => materializeFigmaPayload(item, blobs, options))
  if (!value || typeof value !== 'object') return value
  if ('__openPencilFigmaBlob' in value) {
    return materializeFigmaBlob(
      value as { __openPencilFigmaBlob?: Uint8Array | Record<string, number> },
      blobs,
      options
    )
  }

  const materialized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (FIGMA_PAYLOAD_PAINT_VARIABLE_FIELDS.has(key) && !options.includePaintVariables) continue
    if (FIGMA_PAYLOAD_VARIABLE_MAP_FIELDS.has(key)) {
      const variableMap = materializeSafeVariableMap(
        child,
        blobs,
        options,
        options.includeVariableMaps ? isSupportedVariableMapEntry : isPropRefVariableMapEntry
      )
      if (variableMap !== undefined) materialized[key] = variableMap
      continue
    }
    materialized[key] = normalizeFigmaPayloadValue(
      key,
      materializeFigmaPayload(child, blobs, options)
    )
  }
  return materialized
}

/**
 * Fields that are ALWAYS set by explicit serialization and must NOT be
 * overwritten by rawNodeFields (which may contain stale Figma defaults).
 * rawNodeFields is a fallback for fields NOT covered by the explicit path.
 *
 * Additionally, applyRawFigmaNodeFields skips any key already present on `nc`,
 * so conditionally-set fields (fontVariations, derivedTextData, strokeJoin,
 * strokeWeight, miterLimit, etc.) are automatically protected when set.
 *
 * NOTE: fillGeometry, strokeGeometry, and vectorData are deliberately NOT
 * listed here. When nodeForGeometryExport suppresses explicit serialization
 * (because raw geometry exists), rawNodeFields must supply these fields.
 */
const RAW_FIELDS_OVERRIDE_BLOCKLIST = new Set([
  // Fields that are structurally dangerous if overwritten by stale raw data:
  'pageType',
  'derivedSymbolData',
  'derivedSymbolDataLayoutVersion',
  'sourceLibraryKey',
  'minSize',
  'maxSize',
  // Variable consumption maps: explicit serialization always sets these when
  // bindings exist, and our VARIABLE_BINDING_FIELDS mapping may produce different
  // kiwi field names than the original raw data for library variable references.
  'variableConsumptionMap',
  'parameterConsumptionMap'
])

/**
 * Resize reflowed this path-text node (glyphs regenerated, strokeGeometry
 * cleared). The raw strokeGeometry silhouettes are still at the pre-resize
 * size, so exporting them would paint stale full-size outlines.
 */
function isReflowedStrokedPathText(node: SceneNode): boolean {
  if (node.type !== 'TEXT' || node.textPathData === null) return false
  if ((node.derivedTextGlyphs?.length ?? 0) === 0 || node.textPathBox === null) return false
  if (node.strokeGeometry.length !== 0) return false
  // Only when the node has stroke paint but its baked silhouettes were
  // cleared by reflow (see resize.ts). Fill-only path text (no stroke paint,
  // so strokeGeometry is always empty) is untouched and keeps its raw
  // derivedTextData verbatim.
  //
  // This must key off live node.strokes, not rawNodeFields.strokeGeometry:
  // clearResizedRawGeometry (resize.ts) deletes that raw field on every
  // resize commit, so it's already gone by the time a reflowed node reaches
  // export and can never be used to detect reflow here.
  return node.strokes.length > 0
}

/**
 * An imported path-text node that was edited after import — moving/rotating
 * clears rawTransform (see clearEditedSourceMetadata), so the transform + size
 * are recomputed from the node's post-expand box (exportNodeTransform /
 * exportNodeSize). But the raw derivedTextData + baked silhouettes are still the
 * PRE-expand (un-shifted) payload — exporting them against the shifted box
 * re-triggers the import expand on reimport and drifts the node. Rebuild
 * derivedTextData from the live (shifted) glyphs and re-derive silhouettes,
 * exactly like the reflow path. rawTransform === null is the "edited" signal;
 * pristine nodes keep rawTransform and their raw payload verbatim.
 */
function isEditedPathText(node: SceneNode): boolean {
  return (
    node.type === 'TEXT' &&
    node.textPathData !== null &&
    // "Edited" = the raw transform no longer backs the node. Editing does not
    // clear source.fig.rawTransform directly; effectiveFigmaSourcePayload
    // derives it from source.editedFields, so ask that, not the raw field.
    effectiveFigmaSourcePayload(node).rawTransform === null &&
    (node.derivedTextGlyphs?.length ?? 0) > 0
  )
}

function applyRawFigmaNodeFields(
  context: SceneNodeToKiwiContext,
  node: SceneNode,
  nc: KiwiNodeChange
): void {
  let rawFields = effectiveFigmaRawNodeFields(node)
  if (isReflowedStrokedPathText(node) || isEditedPathText(node)) {
    // Strip before materializing so the stale blobs never enter the file:
    // silhouettes are re-derived from glyphs by Figma/reimport, and
    // derivedTextData was rebuilt from the reflowed glyphs by
    // serializeTextProps (raw would clobber the new positions).
    rawFields = { ...rawFields }
    delete rawFields.strokeGeometry
    delete rawFields.derivedTextData
  }
  const materialized = materializeFigmaPayload(rawFields, context.blobs, {
    blobIndexByHex: context.blobIndexByHex,
    includePaintVariables: true,
    includeVariableMaps: true
  }) as Partial<KiwiNodeChange>
  for (const key of Object.keys(materialized) as (keyof KiwiNodeChange)[]) {
    if (RAW_FIELDS_OVERRIDE_BLOCKLIST.has(String(key))) continue
    // For paint arrays on imported nodes, the raw NC data preserves the
    // original opacity/color.a split (e.g. opacity=0 for invisible strokes).
    // The scene model may lose this distinction for instance children whose
    // strokes are resolved from component overrides. Prefer the raw data.
    if ((key === 'fillPaints' || key === 'strokePaints') && node.source.id) {
      const paints = materialized[key]
      nc[key] = paints?.map((paint, index) =>
        applyColorVariableBinding(
          context,
          node,
          paint,
          `${key === 'fillPaints' ? 'fills' : 'strokes'}/${index}/color`
        )
      )
      continue
    }
    if (key === 'effects' && node.source.id) {
      nc[key] = context.assetRefToVarGuid?.size
        ? convertColorVarAssetRefs(materialized[key], context.assetRefToVarGuid)
        : materialized[key]
      continue
    }
    if (key === 'derivedTextData' && node.source.id) {
      nc.derivedTextData = materialized.derivedTextData
      continue
    }
    if (key === 'textDecorationFillPaints' && node.source.id) {
      nc.textDecorationFillPaints = materialized.textDecorationFillPaints
      continue
    }
    // Skip any key already set on nc — explicit serialization takes priority
    if (key in nc) continue
    nc[key] = materialized[key]
  }
}

function suppressAbsentOpaqueStructuralFields(node: SceneNode, nc: KiwiNodeChange): void {
  if (!node.source.fig.rawNodeType) return
  const presence = node.source.fig.rawStructuralFieldPresence
  if (!presence) return
  const editedFields = new Set(node.source.editedFields)
  for (const field of Object.keys(OPAQUE_STRUCTURAL_FIELD_EDIT_KEYS) as OpaqueStructuralField[]) {
    if (presence[field]) continue
    const editKeys = OPAQUE_STRUCTURAL_FIELD_EDIT_KEYS[field]
    if (editKeys.some((editKey) => editedFields.has(editKey))) continue
    deleteOpaqueStructuralField(nc, field)
  }
}

/** Convert asset refs only for payloads whose Kiwi schema rejects asset-ref aliases. */
function convertColorVarAssetRefs<T>(values: T, assetRefToVarGuid: Map<string, GUID>): T {
  if (!Array.isArray(values)) return values
  const converted = values.map((value: ColorVarCarrier) =>
    convertColorVarCarrierAssetRef(value, assetRefToVarGuid)
  )
  return converted.some((value, index) => value !== values[index]) ? (converted as T) : values
}

function convertColorVarCarrierAssetRef(
  value: ColorVarCarrier,
  assetRefToVarGuid: Map<string, GUID>
): ColorVarCarrier {
  const convertedValue = convertOwnColorVarAssetRef(value, assetRefToVarGuid)
  const stopsVar = convertedValue.stopsVar
  if (!stopsVar) return convertedValue
  const convertedStops = stopsVar.map((stop) =>
    convertColorVarCarrierAssetRef(stop, assetRefToVarGuid)
  )
  return convertedStops.some((stop, index) => stop !== stopsVar[index])
    ? { ...convertedValue, stopsVar: convertedStops }
    : convertedValue
}

function convertOwnColorVarAssetRef(
  value: ColorVarCarrier,
  assetRefToVarGuid: Map<string, GUID>
): ColorVarCarrier {
  const colorVar = value.colorVar
  const alias = colorVar?.value?.alias
  if (!colorVar || !alias || alias.guid || !alias.assetRef?.key) return value
  const assetRef = alias.assetRef
  const lookupKey = assetRef.version ? `${assetRef.key}@${assetRef.version}` : assetRef.key
  const guid = assetRefToVarGuid.get(lookupKey) ?? assetRefToVarGuid.get(assetRef.key)
  if (!guid) return value
  return {
    ...value,
    colorVar: {
      ...colorVar,
      value: { ...colorVar.value, alias: { guid } }
    }
  }
}

function applyInstancePayload(
  context: SceneNodeToKiwiContext,
  node: SceneNode,
  nc: KiwiNodeChange,
  localIdCounter: { value: number }
): void {
  if (node.type !== 'INSTANCE' || !node.componentId) return
  const symbolID = getOrCreateNodeGuid(
    context,
    resolveInstanceComponentId(context, node.componentId),
    localIdCounter
  )
  if (symbolID) {
    const symbolData: NonNullable<KiwiNodeChange['symbolData']> = { symbolID }
    const symbolOverrides: KiwiSymbolOverridePayload[] = []
    if (node.source.fig.symbolOverrides.length > 0) {
      symbolOverrides.push(
        ...(materializeFigmaPayload(node.source.fig.symbolOverrides, context.blobs, {
          blobIndexByHex: context.blobIndexByHex,
          includePaintVariables: true,
          includeVariableMaps: true
        }) as KiwiSymbolOverridePayload[])
      )
    }
    mergeOverrides(
      symbolOverrides,
      serializeRuntimePropertyOverrides(context, node, localIdCounter)
    )
    if (symbolOverrides.length > 0) symbolData.symbolOverrides = symbolOverrides
    if (!Number.isFinite(node.componentScale) || node.componentScale <= 0)
      throw new Error('Invalid instance uniform scale')
    if (node.componentScale !== 1 || node.source.fig.uniformScaleFactor != null) {
      symbolData.uniformScaleFactor = node.componentScale
    }
    nc.symbolData = symbolData
  }
  if (
    node.source.fig.componentPropAssignments.length > 0 &&
    !node.source.editedFields.includes('componentPropertyAssignments')
  ) {
    nc.componentPropAssignments = materializeFigmaPayload(
      node.source.fig.componentPropAssignments,
      context.blobs,
      {
        blobIndexByHex: context.blobIndexByHex,
        includePaintVariables: true,
        includeVariableMaps: true
      }
    )
  }
  const retainedGeometry = materializeFigmaPayload(
    node.source.fig.derivedSymbolData,
    context.blobs,
    {
      blobIndexByHex: context.blobIndexByHex,
      includePaintVariables: true,
      includeVariableMaps: true
    }
  ) as DerivedSymbolOverride[]
  nc.derivedSymbolData = snapshotInstanceGeometry(
    context.graph,
    node,
    instanceGuidResolver(context, localIdCounter),
    retainedGeometry,
    (target) => {
      const payload: KiwiNodeChange = {}
      context.serializeGeometry(target, payload, context.blobs)
      if (target.type === 'TEXT')
        context.serializeTextProps(
          target,
          payload,
          context.graph,
          context.fontDigestMap,
          context.blobs,
          context.glyphBlobMap,
          (node.source.format !== 'fig' &&
            context.graph.getNode(node.componentId ?? '')?.source.format !== 'fig') ||
            staleFigmaRawFields(target.source.editedFields).has('derivedTextData')
        )
      if (payload.derivedTextData && !target.derivedLayout)
        delete payload.derivedTextData.layoutSize
      return {
        size: target.type !== 'TEXT' || target.derivedLayout ? exportNodeSize(target) : undefined,
        transform: exportNodeTransform(context, target),
        ...(payload.fillGeometry ? { fillGeometry: payload.fillGeometry } : {}),
        ...(payload.strokeGeometry ? { strokeGeometry: payload.strokeGeometry } : {}),
        ...(payload.vectorData ? { vectorData: payload.vectorData } : {}),
        derivedTextData: payload.derivedTextData
      }
    }
  )
  if (node.source.fig.derivedSymbolDataLayoutVersion != null) {
    nc.derivedSymbolDataLayoutVersion = node.source.fig.derivedSymbolDataLayoutVersion
  }
}

function componentPropertyPreferredValues(
  definition: ComponentPropertyDefinition,
  context: SceneNodeToKiwiContext
) {
  if (
    (definition.type === 'INSTANCE_SWAP' || definition.type === 'SLOT') &&
    definition.preferredValues?.length
  ) {
    return {
      instanceSwapValues: definition.preferredValues.map((value) => {
        const target = context.graph.getNode(value)
        const key = target?.componentKey || target?.sourceLibraryKey || value
        return { type: 'COMPONENT', key }
      })
    }
  }
  if (definition.type === 'VARIANT' && definition.variantOptions?.length) {
    return { stringValues: [...definition.variantOptions] }
  }
  return undefined
}

function componentPropertyNodeField(field: ComponentPropertyReferenceField): string {
  if (field === 'TEXT') return 'TEXT_DATA'
  if (field === 'INSTANCE_SWAP') return 'OVERRIDDEN_SYMBOL_ID'
  if (field === 'SLOT_CONTENT') return 'SLOT_CONTENT_ID'
  return 'VISIBLE'
}

export function buildComponentPropIndex(
  graph: SceneGraph
): ReadonlyMap<string, ComponentPropertyDefinition> {
  const definitions = new Map<string, ComponentPropertyDefinition>()
  for (const candidate of graph.getAllNodes()) {
    for (const definition of candidate.componentPropertyDefinitions) {
      if (!definitions.has(definition.id)) definitions.set(definition.id, definition)
    }
  }
  return definitions
}

function shouldSerializeRawBackedField(
  node: SceneNode,
  rawField: string,
  hasValue: boolean,
  alreadySerialized = false
): boolean {
  return hasValue && !(rawField in effectiveFigmaRawNodeFields(node)) && !alreadySerialized
}

interface ExportedPropertyReference {
  defID: GUID
  componentPropNodeField: string
}
interface ExportedParameterEntry {
  variableField?: string
  variableData?: {
    value: { propRefValue: { defId: GUID } }
    dataType: string
    resolvedDataType: string
  }
}
function mergeParameterBindings(nc: KiwiNodeChange): void {
  const parameters = nc.parameterConsumptionMap as
    | { entries?: Array<{ variableField?: string }> }
    | undefined
  const entries = parameters?.entries ?? []
  const fields = new Set(entries.map((entry) => entry.variableField))
  const variables = nc.variableConsumptionMap?.entries ?? []
  if (!variables.length) return
  nc.parameterConsumptionMap = {
    entries: [...variables.filter((entry) => !fields.has(entry.variableField)), ...entries]
  }
}

function applyParameterReferences(nc: KiwiNodeChange, refs: ExportedPropertyReference[]): void {
  if (!refs.length) return
  const existing = nc.parameterConsumptionMap as { entries?: ExportedParameterEntry[] } | undefined
  const fields = new Set(refs.map((ref) => ref.componentPropNodeField))
  const entries = (existing?.entries ?? []).filter(
    (entry) => !fields.has(entry.variableField ?? '')
  )
  const types: Record<string, string> = {
    VISIBLE: 'BOOLEAN',
    TEXT_DATA: 'STRING',
    OVERRIDDEN_SYMBOL_ID: 'SYMBOL_ID',
    SLOT_CONTENT_ID: 'SLOT_CONTENT_ID'
  }
  for (const ref of refs)
    entries.push({
      variableField: ref.componentPropNodeField,
      variableData: {
        value: { propRefValue: { defId: ref.defID } },
        dataType: 'PROP_REF',
        resolvedDataType: types[ref.componentPropNodeField]
      }
    })
  nc.parameterConsumptionMap = { entries }
}

function authoredSourceLibraryKey(node: SceneNode): string | null {
  if (
    !node.source.id ||
    'sourceLibraryKey' in effectiveFigmaRawNodeFields(node) ||
    node.source.editedFields.includes('sourceLibraryKey')
  )
    return node.sourceLibraryKey
  return null
}

function hasSlotAssignment(context: SceneNodeToKiwiContext, node: SceneNode): boolean {
  return Object.keys(node.componentPropertyAssignments).some(
    (id) => context.componentPropertyDefinitionsById.get(id)?.type === 'SLOT'
  )
}

function applyPublishedComponentMetadata(node: SceneNode, nc: KiwiNodeChange): void {
  if (node.componentKey) nc.componentKey = node.componentKey
  const sourceLibraryKey = authoredSourceLibraryKey(node)
  if (sourceLibraryKey) nc.sourceLibraryKey = sourceLibraryKey
  const publishId = node.publishId ? parseGuidOrNull(node.publishId) : null
  const overrideKey = node.overrideKey ? parseGuidOrNull(node.overrideKey) : null
  if (publishId) nc.publishID = publishId
  if (overrideKey) nc.overrideKey = overrideKey
  if (node.sharedSymbolVersion) nc.sharedSymbolVersion = node.sharedSymbolVersion
  if (node.publishedVersion) nc.publishedVersion = node.publishedVersion
  if (node.type === 'COMPONENT_SET' || node.isPublishable) nc.isPublishable = node.isPublishable
  if (node.type === 'COMPONENT' || node.isSymbolPublishable) {
    nc.isSymbolPublishable = node.isSymbolPublishable
  }
  if (node.symbolDescription) nc.symbolDescription = node.symbolDescription
  if (node.symbolLinks.length > 0) nc.symbolLinks = structuredClone(node.symbolLinks)
}

function applyComponentMetadata(
  context: SceneNodeToKiwiContext,
  node: SceneNode,
  nc: KiwiNodeChange,
  localIdCounter: { value: number }
): void {
  applyPublishedComponentMetadata(node, nc)
  const componentPropDefs = node.componentPropertyDefinitions.map((def) => {
    const record: Record<string, unknown> = {
      id: getOrCreatePropertyGuid(context, def.id, localIdCounter),
      name: def.name,
      type: componentPropertyTypeForKiwi(def.type),
      preferredValues: componentPropertyPreferredValues(def, context)
    }
    if (def.type === 'SLOT') Object.assign(record, slotDefinitionFields(def))
    else {
      record.initialValue = componentPropertyValue(
        def.type,
        def.defaultValue,
        context,
        localIdCounter
      )
      record.varValue = componentPropertyVariableValue(
        def.type,
        def.defaultValue,
        context,
        localIdCounter
      )
    }
    if (def.description) record.description = def.description
    return record
  })
  if (shouldSerializeRawBackedField(node, 'componentPropDefs', componentPropDefs.length > 0)) {
    nc.componentPropDefs = componentPropDefs
  }

  const parameterRefs = node.componentPropertyReferences.map((ref) => ({
    defID: getOrCreatePropertyGuid(context, ref.propertyId, localIdCounter),
    componentPropNodeField: componentPropertyNodeField(ref.field)
  }))
  // Figma binds a slot frame only through its parameter map, never a legacy property ref.
  const componentPropRefs = parameterRefs.filter(
    (ref) => ref.componentPropNodeField !== 'SLOT_CONTENT_ID'
  )
  if (shouldSerializeRawBackedField(node, 'componentPropRefs', componentPropRefs.length > 0)) {
    nc.componentPropRefs = componentPropRefs
  }

  applyParameterReferences(nc, parameterRefs)
  const componentPropAssignments = serializeComponentPropertyAssignments(
    context,
    node,
    localIdCounter
  )
  if (
    hasSlotAssignment(context, node) ||
    shouldSerializeRawBackedField(
      node,
      'componentPropAssignments',
      componentPropAssignments.length > 0,
      Boolean(nc.componentPropAssignments)
    )
  ) {
    nc.componentPropAssignments = componentPropAssignments
  }

  const variantPropSpecs = node.variantPropSpecs.map((spec) => ({
    propDefId: getOrCreatePropertyGuid(context, spec.propDefId, localIdCounter),
    value: spec.value
  }))
  if (
    node.type !== 'INSTANCE' &&
    shouldSerializeRawBackedField(node, 'variantPropSpecs', variantPropSpecs.length > 0)
  ) {
    nc.variantPropSpecs = variantPropSpecs
  }
}

function exportNodeSize(node: SceneNode): Vector {
  // rawSize and rawTransform are a matched pair describing the ORIGINAL Figma
  // box. Once the transform no longer backs the node, exportNodeTransform
  // recomputes it from node dims via computeExportTransform; pairing that with
  // an un-expanded rawSize disagrees about the box (for rotation, a different
  // centre) and the node drifts on reimport. Use rawSize only while the
  // transform still backs it.
  const payload = effectiveFigmaSourcePayload(node)
  return payload.rawSize && payload.rawTransform
    ? { ...payload.rawSize }
    : { x: node.width, y: node.height }
}

function exportNodeTransform(context: SceneNodeToKiwiContext, node: SceneNode): Matrix {
  const rawTransform = effectiveFigmaSourcePayload(node).rawTransform
  return rawTransform ? { ...rawTransform } : context.computeExportTransform(node)
}

function hasRawGeometryPayload(node: SceneNode): boolean {
  const rawNodeFields = effectiveFigmaRawNodeFields(node)
  return 'fillGeometry' in rawNodeFields || 'strokeGeometry' in rawNodeFields
}

function hasRawVectorPayload(node: SceneNode): boolean {
  return 'vectorData' in effectiveFigmaRawNodeFields(node)
}

const SUPPORTED_NORMALIZED_EFFECT_TYPES = new Set([
  'DROP_SHADOW',
  'INNER_SHADOW',
  'LAYER_BLUR',
  'BACKGROUND_BLUR',
  'FOREGROUND_BLUR'
])

function hasRawUnsupportedEffects(node: SceneNode): boolean {
  const effects = effectiveFigmaRawNodeFields(node).effects
  return (
    Array.isArray(effects) &&
    effects.some(
      (effect) =>
        effect &&
        typeof effect === 'object' &&
        'type' in effect &&
        !SUPPORTED_NORMALIZED_EFFECT_TYPES.has(String(effect.type))
    )
  )
}

function nodeForGeometryExport(node: SceneNode): SceneNode {
  if (!hasRawGeometryPayload(node) && !hasRawVectorPayload(node)) return node
  return {
    ...node,
    fillGeometry: hasRawGeometryPayload(node) ? [] : node.fillGeometry,
    strokeGeometry: hasRawGeometryPayload(node) ? [] : node.strokeGeometry,
    vectorNetwork: hasRawVectorPayload(node) ? null : node.vectorNetwork
  }
}

function applySharedStyleProps(
  context: SceneNodeToKiwiContext,
  node: SceneNode,
  nc: KiwiNodeChange
): void {
  const raw = effectiveFigmaRawNodeFields(node)
  const reference = (id: string, field: string) => {
    const imported = raw[field] as { assetRef?: { key?: string; version?: string } } | undefined
    const asset = imported?.assetRef
    const style = context.graph.getNode(id)
    const original = style && effectiveFigmaRawNodeFields(style)
    const guid = context.nodeIdToGuid?.get(id) ?? stringToGuid(id)
    return asset?.key &&
      original?.key === asset.key &&
      (!asset.version || original.version === asset.version)
      ? { assetRef: { key: asset.key, ...(asset.version ? { version: asset.version } : {}) } }
      : { guid }
  }
  if (node.fillStyleId) nc.styleIdForFill = reference(node.fillStyleId, 'styleIdForFill')
  if (node.strokeStyleId)
    nc.styleIdForStrokeFill = reference(node.strokeStyleId, 'styleIdForStrokeFill')
  if (node.textStyleId) nc.styleIdForText = reference(node.textStyleId, 'styleIdForText')
  if (node.effectStyleId) nc.styleIdForEffect = reference(node.effectStyleId, 'styleIdForEffect')
  if (node.gridStyleId) nc.styleIdForGrid = reference(node.gridStyleId, 'styleIdForGrid')
  if (node.layoutGrids.length > 0) nc.layoutGrids = structuredClone(node.layoutGrids)
  if (node.guides.length > 0) nc.guides = exportCanvasGuides(node.guides)
}

function applyNodeVisualProps(
  context: SceneNodeToKiwiContext,
  node: SceneNode,
  nc: KiwiNodeChange
): void {
  if (node.independentStrokeWeights) {
    nc.borderStrokeWeightsIndependent = true
    nc.borderTopWeight = node.borderTopWeight
    nc.borderRightWeight = node.borderRightWeight
    nc.borderBottomWeight = node.borderBottomWeight
    nc.borderLeftWeight = node.borderLeftWeight
  }

  if (node.fills.length > 0) nc.fillPaints = createFillPaints(context, node)

  context.serializeCornerRadii(node, nc)

  if (node.effects.length > 0 && !hasRawUnsupportedEffects(node)) {
    nc.effects = node.effects.map((effect) => ({
      type: effect.type === 'LAYER_BLUR' ? 'FOREGROUND_BLUR' : effect.type,
      color: context.safeColor(effect.color),
      offset: effect.offset,
      radius: effect.radius,
      spread: effect.spread,
      visible: effect.visible,
      blendMode: effect.blendMode ?? 'NORMAL',
      showShadowBehindNode: effect.showShadowBehindNode
    }))
  }

  if (node.type === 'TEXT') {
    context.serializeTextProps(
      node,
      nc,
      context.graph,
      context.fontDigestMap,
      context.blobs,
      context.glyphBlobMap
    )
  }

  if (node.type !== 'VECTOR') nc.frameMaskDisabled = !node.clipsContent
  applySharedStyleProps(context, node, nc)
  if (node.horizontalConstraint !== 'MIN') nc.horizontalConstraint = node.horizontalConstraint
  if (node.verticalConstraint !== 'MIN') nc.verticalConstraint = node.verticalConstraint
  if (node.strokeCap !== 'NONE') nc.strokeCap = node.strokeCap
  const rawNodeFields = effectiveFigmaRawNodeFields(node)
  if (node.strokeJoin !== 'MITER' || 'strokeJoin' in rawNodeFields) {
    nc.strokeJoin = node.strokeJoin
  }
  if (node.strokeMiterLimit !== DEFAULT_STROKE_MITER_LIMIT || 'miterLimit' in rawNodeFields) {
    nc.miterLimit = node.strokeMiterLimit
  }
  if (node.dashPattern.length > 0) nc.dashPattern = node.dashPattern
  if (node.arcData) {
    nc.arcData = {
      startingAngle: node.arcData.startingAngle,
      endingAngle: node.arcData.endingAngle,
      innerRadius: node.arcData.innerRadius
    }
  }
  if (!node.autoRename) nc.autoRename = false
}

/**
 * Import maps TEXT_PATH → TEXT. Re-emit Kiwi type 41 only while path fidelity
 * remains (materialized path data + baked glyphs). After an edit that cannot
 * reflow glyphs, invalidation clears the path data so export falls back to TEXT.
 */
function exportKiwiNodeType(node: SceneNode, context: SceneNodeToKiwiContext): string {
  const isPathText =
    node.textPathData !== null && node.type === 'TEXT' && (node.derivedTextGlyphs?.length ?? 0) > 0
  return isPathText ? 'TEXT_PATH' : context.mapToFigmaType(node)
}

export function sceneNodeToKiwiWithContext(
  source: SceneNode,
  parentGuid: GUID,
  childIndex: number,
  localIdCounter: { value: number },
  context: SceneNodeToKiwiContext
): KiwiNodeChange[] {
  const node = nodeWithResolvedBindings(context.graph, context.getExportNode(source))
  const guid = getOrCreateNodeGuid(context, node.id, localIdCounter) ?? {
    sessionID: 1,
    localID: localIdCounter.value++
  }

  const strokePaints = createStrokePaints(context, node)

  const exportType = exportKiwiNodeType(node, context)

  const nc: KiwiNodeChange = {
    guid,
    parentIndex: {
      guid: parentGuid,
      position: exportOrderKey(context, node, childIndex)
    },
    type: exportType,
    name: node.name,
    visible: node.visible,
    opacity: node.opacity,
    phase: 'CREATED',
    size: exportNodeSize(node),
    transform: exportNodeTransform(context, node)
  }
  if (node.sharedStyleType) nc.styleType = node.sharedStyleType
  if (node.type === 'GROUP') {
    nc.resizeToFit = true
  }
  // Only set strokeWeight/strokeAlign when the node has strokes in the scene
  // model. For imported nodes without strokes but with raw strokeWeight data
  // (e.g. text nodes, instance children with scaled strokes), the raw value
  // must be allowed to flow through via applyRawFigmaNodeFields.
  if (node.strokes.length > 0) {
    nc.strokeWeight = node.strokes[0].weight
    nc.strokeAlign = node.strokes[0].align
  }
  if (node.locked) nc.locked = true

  applyNodeVisualProps(context, node, nc)
  applyInstancePayload(context, node, nc, localIdCounter)
  applyComponentMetadata(context, node, nc, localIdCounter)
  if (node.type === 'COMPONENT_SET') upsertPluginData(node, NODE_TYPE_PLUGIN_KEY, node.type)
  if (nc.type === 'CANVAS') nc.pageType = 'DESIGN'
  if (node.type === 'BOOLEAN_OPERATION')
    nc.booleanOperation = toKiwiBooleanOperation(node.booleanOperation)
  if (strokePaints.length > 0) nc.strokePaints = strokePaints

  context.serializeLayoutProps(node, nc)
  context.serializeGeometry(nodeForGeometryExport(node), nc, context.blobs)
  context.serializeVariableBindings(node, nc, context.graph, context.varIdToGuid)
  mergeParameterBindings(nc)
  applyRawFigmaNodeFields(context, node, nc)
  const variableModeBySetMap = serializeVariableModes(
    node,
    context.varIdToGuid,
    context.modeIdToGuid
  )
  if (variableModeBySetMap) nc.variableModeBySetMap = variableModeBySetMap

  applyExportSettingsPluginData(node)
  applyLibrarySourcePluginData(node)
  applyLayoutPreferences(node)
  applyTextPathBoxPluginData(node)
  const additionalPluginData = context.getAdditionalPluginData(node, context.graph)
  const pluginData = mergePluginData(
    additionalPluginData.length === 0
      ? node.pluginData
      : [...node.pluginData, ...additionalPluginData]
  )
  if (pluginData.length > 0) nc.pluginData = pluginData
  if (node.pluginRelaunchData.length > 0) {
    nc.pluginRelaunchData = serializePluginRelaunchData(node.pluginRelaunchData)
  }
  suppressAbsentOpaqueStructuralFields(node, nc)

  const result: KiwiNodeChange[] = [nc]
  const children =
    node.type === 'INSTANCE'
      ? []
      : context
          .getExportChildren(node)
          .filter((child) => !child.internalOnly && child.sharedStyleType === null)
  for (let i = 0; i < children.length; i++) {
    result.push(...context.sceneNodeToKiwi(children[i], guid, i, localIdCounter, context))
  }
  return result
}
