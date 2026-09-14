import type { PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'

import type { BusinessTemplateId } from '../model/types'
import { BUSINESS_TEMPLATE_IDS } from '../model/types'

export const BUSINESS_PAGE_PLUGIN_ID = 'open-pencil.business-pages'
const key = 'navigation/v1'

export type BusinessPageMarker =
  | {
      readonly version: 1
      readonly role: 'page'
      readonly applicationId: string
      readonly kind: BusinessTemplateId
      readonly pageKey: string
    }
  | {
      readonly version: 1
      readonly role: 'navigation'
      readonly applicationId: string
      readonly knownKeys: readonly string[]
    }

function text(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 256 && !/\p{Cc}/u.test(value)
  )
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((name) => name in value)
}

export function readBusinessPageMarker(node: SceneNode): BusinessPageMarker | undefined {
  const entries = node.pluginData.filter(
    (entry) => entry.pluginId === BUSINESS_PAGE_PLUGIN_ID && entry.key === key
  )
  if (entries.length !== 1 || entries[0].value.length > 16_384) return undefined
  let value: unknown
  try {
    value = JSON.parse(entries[0].value)
  } catch {
    return undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  if (record.version !== 1 || !text(record.applicationId)) return undefined
  if (
    record.role === 'page' &&
    exact(record, ['version', 'role', 'applicationId', 'kind', 'pageKey']) &&
    text(record.pageKey)
  ) {
    const kind = BUSINESS_TEMPLATE_IDS.find((entry) => entry === record.kind)
    return kind
      ? {
          version: 1,
          role: 'page',
          applicationId: record.applicationId,
          kind,
          pageKey: record.pageKey
        }
      : undefined
  }
  if (
    record.role !== 'navigation' ||
    !exact(record, ['version', 'role', 'applicationId', 'knownKeys']) ||
    !Array.isArray(record.knownKeys) ||
    record.knownKeys.length > 100
  )
    return undefined
  const knownKeys = record.knownKeys.filter(text)
  if (knownKeys.length !== record.knownKeys.length || new Set(knownKeys).size !== knownKeys.length)
    return undefined
  return { version: 1, role: 'navigation', applicationId: record.applicationId, knownKeys }
}

export function businessMarkerData(
  marker: BusinessPageMarker,
  existing: readonly PluginDataEntry[] = []
): PluginDataEntry[] {
  return [
    ...existing.filter((entry) => entry.pluginId !== BUSINESS_PAGE_PLUGIN_ID || entry.key !== key),
    { pluginId: BUSINESS_PAGE_PLUGIN_ID, key, value: JSON.stringify(marker) }
  ]
}
