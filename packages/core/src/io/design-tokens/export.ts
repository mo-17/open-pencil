import type {
  SceneGraph,
  Variable,
  VariableCollection,
  VariableValue
} from '@open-pencil/scene-graph'

import { colorToHex } from '#core/color'

const MAX_EXPORT_BYTES = 4 * 1024 * 1024
const MAX_COLLECTIONS = 1_024
const MAX_MODES_PER_COLLECTION = 64
const MAX_EXPORTED_TOKENS = 10_000
const MAX_STORED_VARIABLES = 20_000
const MAX_VARIABLE_REFERENCES = 20_000
const encoder = new TextEncoder()

export const DESIGN_TOKENS_FORMAT = 'openpencil-design-tokens' as const
export const DESIGN_TOKENS_SCHEMA_VERSION = 1 as const

export interface DesignTokenExportStats {
  collectionCount: number
  modeCount: number
  tokenCount: number
}

export interface DesignTokenExportResult {
  text: string
  stats: DesignTokenExportStats
}

type ExportedTokenValue = VariableValue | { $alias: string }

interface TokenColorCandidate {
  r?: unknown
  g?: unknown
  b?: unknown
  a?: unknown
}

function compareNameAndId(
  left: Readonly<{ name: string; id: string }>,
  right: Readonly<{ name: string; id: string }>
): number {
  return compareText(left.name, right.name) || compareText(left.id, right.id)
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function tokenType(variable: Variable): 'color' | 'number' | 'string' | 'boolean' {
  if (variable.type === 'COLOR') return 'color'
  if (variable.type === 'FLOAT') return 'number'
  if (variable.type === 'BOOLEAN') return 'boolean'
  return 'string'
}

function aliasTarget(value: VariableValue): string | null {
  const candidate: unknown = value
  if (candidate === null || typeof candidate !== 'object' || !('aliasId' in candidate)) return null
  const aliasId = (candidate as { aliasId?: unknown }).aliasId
  if (typeof aliasId !== 'string' || aliasId.length === 0 || aliasId.length > 512) {
    throw new TypeError('Design token alias id is invalid')
  }
  return aliasId
}

function assertVariableValueType(variable: Variable, value: unknown, modeId: string): void {
  if (aliasTarget(value as VariableValue)) return
  const color = value as TokenColorCandidate | null
  const valid =
    (variable.type === 'FLOAT' && typeof value === 'number' && Number.isFinite(value)) ||
    (variable.type === 'STRING' && typeof value === 'string') ||
    (variable.type === 'BOOLEAN' && typeof value === 'boolean') ||
    (variable.type === 'COLOR' &&
      color !== null &&
      typeof color === 'object' &&
      [color.r, color.g, color.b, color.a].every((channel) => Number.isFinite(channel)))
  if (!valid) {
    throw new TypeError(`Design token ${variable.id} has an invalid value for mode ${modeId}`)
  }
}

function assertAliasGraph(graph: SceneGraph, exportedIds: ReadonlySet<string>): void {
  const edges = new Map<string, string[]>()
  const incoming = new Map<string, number>([...exportedIds].map((id) => [id, 0]))
  for (const variableId of exportedIds) {
    const variable = graph.variables.get(variableId)
    if (!variable) throw new TypeError(`Design token alias target is missing: ${variableId}`)
    const targets: string[] = []
    const collection = graph.variableCollections.get(variable.collectionId)
    if (!collection) {
      throw new TypeError(`Design token collection is missing: ${variable.collectionId}`)
    }
    for (const { modeId } of collection.modes) {
      const targetId = aliasTarget(variable.valuesByMode[modeId])
      if (!targetId) continue
      if (!exportedIds.has(targetId)) {
        throw new TypeError(`Design token alias points to a hidden or missing token: ${targetId}`)
      }
      const target = graph.variables.get(targetId)
      if (!target || target.type !== variable.type) {
        throw new TypeError(`Design token alias type mismatch: ${variableId} -> ${targetId}`)
      }
      targets.push(targetId)
      incoming.set(targetId, (incoming.get(targetId) ?? 0) + 1)
    }
    edges.set(variableId, targets)
  }

  const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => id)
  let visited = 0
  for (const variableId of queue) {
    visited += 1
    for (const targetId of edges.get(variableId) ?? []) {
      const next = (incoming.get(targetId) ?? 0) - 1
      incoming.set(targetId, next)
      if (next === 0) queue.push(targetId)
    }
  }
  if (visited !== exportedIds.size) throw new TypeError('Design token alias cycle detected')
}

function exportValue(value: VariableValue, graph: SceneGraph): ExportedTokenValue {
  const targetId = aliasTarget(value)
  if (targetId) {
    const target = graph.variables.get(targetId)
    if (!target) throw new TypeError(`Design token alias target is missing: ${targetId}`)
    return { $alias: target.id }
  }
  if (typeof value === 'object' && 'r' in value) {
    return colorToHex(value).toLowerCase()
  }
  return value
}

function exportedVariableIds(graph: SceneGraph): Set<string> {
  if (graph.variableCollections.size > MAX_COLLECTIONS) {
    throw new TypeError(`Design token export may not exceed ${MAX_COLLECTIONS} collections`)
  }
  if (graph.variables.size > MAX_STORED_VARIABLES) {
    throw new TypeError(
      `Design token export may not inspect more than ${MAX_STORED_VARIABLES} tokens`
    )
  }
  const referencedIds = new Set<string>()
  let variableReferenceCount = 0
  for (const collection of graph.variableCollections.values()) {
    if (collection.modes.length > MAX_MODES_PER_COLLECTION) {
      throw new TypeError(
        `Design token collection ${collection.id} may not exceed ${MAX_MODES_PER_COLLECTION} modes`
      )
    }
    const modeIds = collection.modes.map(({ modeId }) => modeId)
    if (modeIds.length === 0 || new Set(modeIds).size !== modeIds.length) {
      throw new TypeError(`Design token collection ${collection.id} has invalid modes`)
    }
    if (!modeIds.includes(collection.defaultModeId)) {
      throw new TypeError(`Design token collection ${collection.id} has an invalid default mode`)
    }
    variableReferenceCount += collection.variableIds.length
    if (variableReferenceCount > MAX_VARIABLE_REFERENCES) {
      throw new TypeError(
        `Design token collections may not contain more than ${MAX_VARIABLE_REFERENCES} token references`
      )
    }
    if (new Set(collection.variableIds).size !== collection.variableIds.length) {
      throw new TypeError(`Design token collection ${collection.id} contains duplicate token ids`)
    }
    for (const variableId of collection.variableIds) {
      const variable = graph.variables.get(variableId)
      if (!variable) {
        throw new TypeError(
          `Design token collection ${collection.id} references a missing token: ${variableId}`
        )
      }
      if (variable.collectionId !== collection.id) {
        throw new TypeError(`Design token ${variableId} belongs to a different collection`)
      }
      if (!variable.hiddenFromPublishing) {
        assertExactModeValues(variable, modeIds)
        referencedIds.add(variableId)
      }
      if (referencedIds.size > MAX_EXPORTED_TOKENS) {
        throw new TypeError(`Design token export may not exceed ${MAX_EXPORTED_TOKENS} tokens`)
      }
    }
  }
  for (const variable of graph.variables.values()) {
    if (!variable.hiddenFromPublishing && !referencedIds.has(variable.id)) {
      throw new TypeError(`Published design token is not in its collection: ${variable.id}`)
    }
  }
  return referencedIds
}

function assertExactModeValues(variable: Variable, modeIds: readonly string[]): void {
  const allowed = new Set(modeIds)
  let count = 0
  for (const modeId in variable.valuesByMode) {
    if (!Object.hasOwn(variable.valuesByMode, modeId)) continue
    count += 1
    if (count > MAX_MODES_PER_COLLECTION || !allowed.has(modeId)) {
      throw new TypeError(
        `Design token ${variable.id} contains an unexpected mode value: ${modeId}`
      )
    }
    const descriptor = Object.getOwnPropertyDescriptor(variable.valuesByMode, modeId)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`Design token ${variable.id} contains a non-data mode value: ${modeId}`)
    }
    assertVariableValueType(variable, descriptor.value, modeId)
  }
  for (const modeId of modeIds) {
    if (!Object.hasOwn(variable.valuesByMode, modeId)) {
      throw new TypeError(`Design token ${variable.id} is missing a value for mode ${modeId}`)
    }
  }
}

function assertInputBudget(
  graph: SceneGraph,
  collections: readonly VariableCollection[],
  exportedIds: ReadonlySet<string>
): void {
  let estimatedBytes = 512
  const addText = (value: string): void => {
    if (value.length > MAX_EXPORT_BYTES - estimatedBytes) {
      throw new TypeError(`Design token export may not exceed ${MAX_EXPORT_BYTES} bytes`)
    }
    estimatedBytes += encoder.encode(value).byteLength + 16
    if (estimatedBytes > MAX_EXPORT_BYTES) {
      throw new TypeError(`Design token export may not exceed ${MAX_EXPORT_BYTES} bytes`)
    }
  }
  for (const collection of collections) {
    estimatedBytes += 256
    addText(collection.id)
    addText(collection.name)
    addText(collection.defaultModeId)
    for (const mode of collection.modes) {
      estimatedBytes += 64
      addText(mode.modeId)
      addText(mode.name)
    }
  }
  for (const variableId of exportedIds) {
    const variable = graph.variables.get(variableId)
    if (!variable) continue
    estimatedBytes += 384
    addText(variable.id)
    addText(variable.name)
    addText(variable.description)
    const collection = graph.variableCollections.get(variable.collectionId)
    if (!collection) continue
    for (const { modeId } of collection.modes) {
      const value = variable.valuesByMode[modeId]
      estimatedBytes += 64
      addText(modeId)
      if (typeof value === 'string') addText(value)
      else {
        const targetId = aliasTarget(value)
        if (targetId) addText(targetId)
      }
    }
  }
}

/**
 * Export published variables without resolving aliases so downstream token tools
 * retain their dependency graph. The output is deterministic and intentionally
 * keeps OpenPencil ids beside human names to avoid lossy slug generation.
 */
export function exportDesignTokens(graph: SceneGraph): DesignTokenExportResult {
  if (graph.variableCollections.size > MAX_COLLECTIONS) {
    throw new TypeError(`Design token export may not exceed ${MAX_COLLECTIONS} collections`)
  }
  const collections = [...graph.variableCollections.values()].sort(compareNameAndId)
  const exportedIds = exportedVariableIds(graph)
  const exportedVariables = [...exportedIds]
    .map((id) => {
      const variable = graph.variables.get(id)
      if (!variable) throw new TypeError(`Design token is missing: ${id}`)
      return variable
    })
    .sort(compareNameAndId)
  assertInputBudget(graph, collections, exportedIds)
  assertAliasGraph(graph, exportedIds)

  let modeCount = 0
  const payload = {
    format: DESIGN_TOKENS_FORMAT,
    schemaVersion: DESIGN_TOKENS_SCHEMA_VERSION,
    collections: collections.map((collection) => {
      const modes = [...collection.modes].sort(
        (left, right) =>
          compareText(left.name, right.name) || compareText(left.modeId, right.modeId)
      )
      modeCount += modes.length
      const variables = collection.variableIds
        .map((id) => graph.variables.get(id))
        .filter((variable): variable is Variable =>
          Boolean(variable && exportedIds.has(variable.id))
        )
        .sort(compareNameAndId)
      return {
        id: collection.id,
        name: collection.name,
        defaultModeId: collection.defaultModeId,
        modes: modes.map(({ modeId, name }) => ({ id: modeId, name })),
        tokens: variables.map((variable) => ({
          id: variable.id,
          name: variable.name,
          $type: tokenType(variable),
          ...(variable.description ? { description: variable.description } : {}),
          valuesByMode: Object.fromEntries(
            modes.map(({ modeId }) => {
              if (!Object.hasOwn(variable.valuesByMode, modeId)) {
                throw new TypeError(
                  `Design token ${variable.id} is missing a value for mode ${modeId}`
                )
              }
              return [modeId, exportValue(variable.valuesByMode[modeId], graph)]
            })
          )
        }))
      }
    })
  }
  const text = `${JSON.stringify(payload, null, 2)}\n`
  const byteLength = encoder.encode(text).byteLength
  if (byteLength > MAX_EXPORT_BYTES) {
    throw new TypeError(`Design token export may not exceed ${MAX_EXPORT_BYTES} bytes`)
  }
  return {
    text,
    stats: {
      collectionCount: collections.length,
      modeCount,
      tokenCount: exportedVariables.length
    }
  }
}
