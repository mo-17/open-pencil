import { omit } from 'es-toolkit/object'

import type { NodeChange, PluginData, PluginRelaunchData } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import {
  clampExportScale,
  hasPluginData,
  OPEN_PENCIL_PLUGIN_DATA,
  OPEN_PENCIL_PLUGIN_ID,
  withPluginData,
  type ExportFormatId,
  type ExportSetting,
  type PluginDataEntry,
  type PluginDataField,
  type PluginRelaunchDataEntry,
  type SceneNode
} from '@open-pencil/scene-graph'
import type { GUID, Rect } from '@open-pencil/scene-graph/primitives'

import { FIGMA_MOTION_SHARED_KEY, FIGMA_MOTION_SHARED_NAMESPACE } from '../motion-native'
import { readEffectiveFigmaRawField } from '../source-metadata'
import {
  resolveVariableConsumptionEntry,
  variableConsumptionEntries,
  VARIABLE_BINDING_FIELDS_INVERSE,
  referencesVariable
} from './variable/bindings'

const { boundVariables, exportSettings, librarySource, textPathBox } = OPEN_PENCIL_PLUGIN_DATA

const NATIVE_EXPORT_FORMATS: Record<string, ExportFormatId> = {
  PNG: 'png',
  JPEG: 'jpg',
  SVG: 'svg',
  PDF: 'pdf'
}

/** An OpenPencil plugin-data value on a record read from a `.fig` file. */
export function readNodeChangePluginData<T>(
  nc: Pick<NodeChange, 'pluginData'>,
  field: PluginDataField<T>
): T | undefined {
  return field.decode(
    nc.pluginData?.find(
      (entry) => entry.pluginID === OPEN_PENCIL_PLUGIN_ID && entry.key === field.key
    )?.value
  )
}

export function applyExportSettingsPluginData(
  node: Pick<SceneNode, 'exportSettings' | 'pluginData' | 'source'>
): void {
  if (node.exportSettings.length === 0) return
  if (
    !hasPluginData(node.pluginData, exportSettings) &&
    Array.isArray(readEffectiveFigmaRawField(node, 'exportSettings'))
  ) {
    return
  }
  node.pluginData = withPluginData(node.pluginData, exportSettings, node.exportSettings)
}

/**
 * textPathBox is OpenPencil-only state (the node-local rect the TEXT_PATH
 * layout path maps onto, after import-time box expansion and resize scaling).
 * The Kiwi schema has no home for it, and reconstructing it from an expanded,
 * resized node is ambiguous — persist it as plugin data so save/reopen keeps
 * reflow anchored correctly.
 */
export function applyTextPathBoxPluginData(node: {
  textPathBox: Rect | null
  pluginData: PluginDataEntry[]
}): void {
  if (!node.textPathBox) return
  node.pluginData = withPluginData(node.pluginData, textPathBox, node.textPathBox)
}

export function extractTextPathBox(nc: NodeChange): Rect | null {
  return readNodeChangePluginData(nc, textPathBox) ?? null
}

export function extractBoundVariables(nc: NodeChange): Record<string, string> {
  let bindings = readNodeChangePluginData(nc, boundVariables) ?? {}
  for (const entry of variableConsumptionEntries(nc)) {
    const binding = resolveVariableConsumptionEntry(entry)
    if (binding) bindings[binding.field] = binding.variableId
    else if (entry.variableField && !referencesVariable(entry.variableData?.dataType)) {
      const field = VARIABLE_BINDING_FIELDS_INVERSE[entry.variableField]
      if (field) bindings = omit(bindings, [field])
    }
  }
  extractPaintBindings(nc, bindings)
  return bindings
}

function extractPaintBindings(nc: NodeChange, bindings: Record<string, string>): void {
  for (const [arrayKey, paints] of [
    ['fills', nc.fillPaints],
    ['strokes', nc.strokePaints]
  ] as const) {
    for (const [i, paint] of (paints ?? []).entries()) {
      const variableGuid =
        validPaintGuid(paint.colorVar?.value?.alias?.guid) ?? legacyPaintGuid(paint)
      if (variableGuid) bindings[`${arrayKey}/${i}/color`] = guidToString(variableGuid)
      for (const [stopIndex, stop] of (paint.stopsVar ?? []).entries()) {
        const guid = stop.colorVar?.value?.alias?.guid
        if (guid) bindings[`${arrayKey}/${i}/gradientStops/${stopIndex}/color`] = guidToString(guid)
      }
    }
  }
}

function validPaintGuid(value: unknown): GUID | undefined {
  if (!value || typeof value !== 'object' || !('sessionID' in value) || !('localID' in value))
    return undefined
  const { sessionID, localID } = value
  if (typeof sessionID !== 'number' || typeof localID !== 'number') return undefined
  if (
    !Number.isSafeInteger(sessionID) ||
    !Number.isSafeInteger(localID) ||
    sessionID < 0 ||
    localID < 0
  )
    return undefined
  return { sessionID, localID }
}

function legacyPaintGuid(paint: object): GUID | undefined {
  if (!('colorVariableBinding' in paint)) return undefined
  const binding = paint.colorVariableBinding
  if (!binding || typeof binding !== 'object' || !('variableID' in binding)) return undefined
  return validPaintGuid(binding.variableID)
}

function mapNativeImageType(imageType: unknown): ExportFormatId | null {
  if (typeof imageType === 'string') return NATIVE_EXPORT_FORMATS[imageType] ?? null
  if (imageType === 0) return 'png'
  if (imageType === 1) return 'jpg'
  if (imageType === 2) return 'svg'
  if (imageType === 3) return 'pdf'
  return null
}

function extractNativeConstraintScale(constraint: unknown): number {
  if (!constraint || typeof constraint !== 'object' || Array.isArray(constraint)) return 1
  const type = (constraint as { type?: unknown }).type
  if (type !== 'CONTENT_SCALE' && type !== 0) return 1
  const value = (constraint as { value?: unknown }).value
  // Clamp native CONTENT_SCALE too: malformed .fig data can carry huge multipliers.
  return typeof value === 'number' && Number.isFinite(value) ? clampExportScale(value) : 1
}

export function extractExportSettings(nc: NodeChange): ExportSetting[] {
  const pluginSettings = readNodeChangePluginData(nc, exportSettings)
  if (pluginSettings) return pluginSettings

  return (nc.exportSettings ?? []).flatMap((entry): ExportSetting[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const format = mapNativeImageType((entry as { imageType?: unknown }).imageType)
    if (!format) return []
    return [
      {
        scale: extractNativeConstraintScale((entry as { constraint?: unknown }).constraint),
        format
      }
    ]
  })
}

export function extractPluginData(nc: NodeChange): PluginDataEntry[] {
  return (nc.pluginData ?? []).map((entry) => ({
    pluginId: entry.pluginID,
    key: entry.key,
    value: entry.value
  }))
}

export function extractLibrarySource(nc: NodeChange): SceneNode['librarySource'] {
  return readNodeChangePluginData(nc, librarySource) ?? null
}

export function applyLibrarySourcePluginData(node: SceneNode): void {
  node.pluginData = withPluginData(node.pluginData, librarySource, node.librarySource ?? undefined)
}

export function extractPluginRelaunchData(nc: NodeChange): PluginRelaunchDataEntry[] {
  return (nc.pluginRelaunchData ?? []).map((entry) => ({
    pluginId: entry.pluginID,
    command: entry.command,
    message: entry.message,
    isDeleted: entry.isDeleted
  }))
}

export function mergePluginData(pluginData: PluginDataEntry[]): PluginData[] {
  let lastSharedMotionIndex = -1
  for (let index = 0; index < pluginData.length; index++) {
    const entry = pluginData[index]
    if (
      entry.pluginId === FIGMA_MOTION_SHARED_NAMESPACE &&
      entry.key === `${FIGMA_MOTION_SHARED_NAMESPACE}/${FIGMA_MOTION_SHARED_KEY}`
    ) {
      lastSharedMotionIndex = index
    }
  }
  return pluginData
    .filter((entry, index) => {
      const isSharedMotion =
        entry.pluginId === FIGMA_MOTION_SHARED_NAMESPACE &&
        entry.key === `${FIGMA_MOTION_SHARED_NAMESPACE}/${FIGMA_MOTION_SHARED_KEY}`
      return !isSharedMotion || index === lastSharedMotionIndex
    })
    .map((entry) => ({
      pluginID: entry.pluginId,
      key: entry.key,
      value: entry.value
    }))
}

export function serializePluginRelaunchData(
  entries: PluginRelaunchDataEntry[]
): PluginRelaunchData[] {
  return entries.map((entry) => ({
    pluginID: entry.pluginId,
    command: entry.command,
    message: entry.message,
    isDeleted: entry.isDeleted
  }))
}

/** Compatibility for persisted fork plugin fields not modeled by the upstream registry. */
export { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/scene-graph'
export const TEXT_DIRECTION_PLUGIN_KEY = OPEN_PENCIL_PLUGIN_DATA.textDirection.key
export const LAYOUT_DIRECTION_PLUGIN_KEY = OPEN_PENCIL_PLUGIN_DATA.layoutDirection.key
export const NODE_TYPE_PLUGIN_KEY = OPEN_PENCIL_PLUGIN_DATA.nodeType.key
export const BOUND_VARIABLES_PLUGIN_KEY = OPEN_PENCIL_PLUGIN_DATA.boundVariables.key
export const EXPORT_SETTINGS_PLUGIN_KEY = OPEN_PENCIL_PLUGIN_DATA.exportSettings.key
export const TEXT_PATH_BOX_PLUGIN_KEY = OPEN_PENCIL_PLUGIN_DATA.textPathBox.key
export const LIBRARY_SOURCE_PLUGIN_KEY = OPEN_PENCIL_PLUGIN_DATA.librarySource.key
export const ENABLED_LIBRARIES_PLUGIN_KEY = OPEN_PENCIL_PLUGIN_DATA.enabledLibraries.key
export function upsertPluginData(
  node: { pluginData: PluginDataEntry[] },
  key: string,
  value: string
): void {
  const pluginData = node.pluginData.filter(
    (entry) => !(entry.pluginId === OPEN_PENCIL_PLUGIN_ID && entry.key === key)
  )
  pluginData.push({ pluginId: OPEN_PENCIL_PLUGIN_ID, key, value })
  node.pluginData = pluginData
}

export function removePluginData(node: { pluginData: PluginDataEntry[] }, key: string): void {
  node.pluginData = node.pluginData.filter(
    (entry) => !(entry.pluginId === OPEN_PENCIL_PLUGIN_ID && entry.key === key)
  )
}

export function getOpenPencilPluginValue(nc: NodeChange, key: string): string | null {
  return (
    nc.pluginData?.find((entry) => entry.pluginID === OPEN_PENCIL_PLUGIN_ID && entry.key === key)
      ?.value ?? null
  )
}
