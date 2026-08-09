import type { Variable, VariableCollection } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

import {
  addDesignSystemAuditIssue,
  boundedAuditText,
  designSystemAuditCheckpoint,
  DESIGN_SYSTEM_AUDIT_LIMITS,
  markDesignSystemAuditBudgetExhausted,
  normalizedAuditKey,
  type DesignSystemAuditState
} from './support'

export interface DesignSystemAuditCollectionInfo {
  collection: VariableCollection
  modeIds: Set<string>
  variableIds: Set<string>
  membershipComplete: boolean
}

const MAX_COLLECTION_MODES = 256
const MAX_COLLECTION_REFERENCES = 20_000
const MAX_VARIABLE_MODE_VALUES = 256

function collectionIssue(
  state: DesignSystemAuditState,
  code: string,
  message: string,
  collection: VariableCollection
): void {
  addDesignSystemAuditIssue(state, {
    category: 'tokens',
    code,
    severity: 'warning',
    message: `${message} Collection: ${boundedAuditText(collection.name, 256)}.`
  })
}

export async function inspectDesignSystemCollections(
  editor: EditorStore,
  state: DesignSystemAuditState,
  signal: AbortSignal | undefined
): Promise<Map<string, DesignSystemAuditCollectionInfo>> {
  const infos = new Map<string, DesignSystemAuditCollectionInfo>()
  const names = new Map<string, string>()
  for (const [collectionId, collection] of editor.graph.variableCollections) {
    if (state.collectionCount >= DESIGN_SYSTEM_AUDIT_LIMITS.collections) {
      markDesignSystemAuditBudgetExhausted(state)
      break
    }
    state.collectionCount += 1
    await designSystemAuditCheckpoint(state, signal)
    const collectionName = normalizedAuditKey(collection.name)
    const previousCollectionId = names.get(collectionName)
    if (collectionName && previousCollectionId && previousCollectionId !== collectionId) {
      collectionIssue(
        state,
        'duplicate-collection-name',
        `Another token collection uses the same normalized name (${boundedAuditText(previousCollectionId, 256)})`,
        collection
      )
    } else if (collectionName) {
      names.set(collectionName, collectionId)
    }

    const modeIds = new Set<string>()
    const modeNames = new Set<string>()
    const modeCount = Math.min(collection.modes.length, MAX_COLLECTION_MODES)
    if (collection.modes.length > modeCount) markDesignSystemAuditBudgetExhausted(state)
    for (let index = 0; index < modeCount; index += 1) {
      if (state.totalCollectionModes >= DESIGN_SYSTEM_AUDIT_LIMITS.collectionModes) {
        markDesignSystemAuditBudgetExhausted(state)
        break
      }
      state.totalCollectionModes += 1
      const mode = collection.modes[index]
      if (modeIds.has(mode.modeId)) {
        collectionIssue(
          state,
          'duplicate-mode-id',
          `Mode id ${boundedAuditText(mode.modeId, 256)} is duplicated`,
          collection
        )
      }
      modeIds.add(mode.modeId)
      const modeName = normalizedAuditKey(mode.name)
      if (modeName && modeNames.has(modeName)) {
        collectionIssue(
          state,
          'duplicate-mode-name',
          `Mode name ${boundedAuditText(mode.name, 256)} is duplicated`,
          collection
        )
      }
      if (modeName) modeNames.add(modeName)
    }
    if (!modeIds.has(collection.defaultModeId)) {
      collectionIssue(
        state,
        'invalid-default-mode',
        `Default mode ${boundedAuditText(collection.defaultModeId, 256)} is not declared`,
        collection
      )
    }

    const variableIds = new Set<string>()
    let membershipComplete = true
    const referenceCount = Math.min(collection.variableIds.length, MAX_COLLECTION_REFERENCES)
    if (collection.variableIds.length > referenceCount) {
      membershipComplete = false
      markDesignSystemAuditBudgetExhausted(state)
    }
    for (let index = 0; index < referenceCount; index += 1) {
      if (
        state.totalCollectionVariableReferences >=
        DESIGN_SYSTEM_AUDIT_LIMITS.collectionVariableReferences
      ) {
        membershipComplete = false
        markDesignSystemAuditBudgetExhausted(state)
        break
      }
      state.totalCollectionVariableReferences += 1
      await designSystemAuditCheckpoint(state, signal)
      const variableId = collection.variableIds[index]
      if (variableIds.has(variableId)) {
        collectionIssue(
          state,
          'duplicate-variable-reference',
          `Variable reference ${boundedAuditText(variableId, 256)} is duplicated`,
          collection
        )
      }
      variableIds.add(variableId)
      if (!editor.graph.variables.has(variableId)) {
        collectionIssue(
          state,
          'missing-variable-reference',
          `Variable reference ${boundedAuditText(variableId, 256)} does not exist`,
          collection
        )
      }
    }
    infos.set(collectionId, { collection, modeIds, variableIds, membershipComplete })
  }
  return infos
}

function aliasId(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = Reflect.get(value, 'aliasId')
  return typeof candidate === 'string' ? candidate : null
}

function variableIssue(
  state: DesignSystemAuditState,
  code: string,
  message: string,
  variable: Variable
): void {
  addDesignSystemAuditIssue(state, {
    category: 'tokens',
    code,
    severity: 'warning',
    message: `${message} Token: ${boundedAuditText(variable.name, 256)}.`
  })
}

export async function inspectDesignSystemVariables(
  editor: EditorStore,
  collections: ReadonlyMap<string, DesignSystemAuditCollectionInfo>,
  state: DesignSystemAuditState,
  signal: AbortSignal | undefined
): Promise<void> {
  const names = new Map<string, string>()
  for (const [variableId, variable] of editor.graph.variables) {
    if (state.variableCount >= DESIGN_SYSTEM_AUDIT_LIMITS.variables) {
      markDesignSystemAuditBudgetExhausted(state)
      break
    }
    state.variableCount += 1
    await designSystemAuditCheckpoint(state, signal)
    const collection = collections.get(variable.collectionId)
    if (!collection) {
      variableIssue(
        state,
        'missing-variable-collection',
        `Collection ${boundedAuditText(variable.collectionId, 256)} does not exist or was outside the audit budget`,
        variable
      )
      continue
    }
    if (collection.membershipComplete && !collection.variableIds.has(variableId)) {
      variableIssue(
        state,
        'missing-collection-membership',
        'The token is not referenced by its collection',
        variable
      )
    }
    const nameKey = `${boundedAuditText(variable.collectionId, 256)}\0${normalizedAuditKey(variable.name)}`
    const previousVariableId = names.get(nameKey)
    if (previousVariableId && previousVariableId !== variableId) {
      variableIssue(
        state,
        'duplicate-token-name',
        `Another token in the collection uses the same normalized name (${boundedAuditText(previousVariableId, 256)})`,
        variable
      )
    } else {
      names.set(nameKey, variableId)
    }

    for (const modeId of collection.modeIds) {
      if (state.totalVariableModeValues >= DESIGN_SYSTEM_AUDIT_LIMITS.variableModeValues) {
        markDesignSystemAuditBudgetExhausted(state)
        break
      }
      state.totalVariableModeValues += 1
      if (!Object.hasOwn(variable.valuesByMode, modeId)) {
        variableIssue(
          state,
          'missing-mode-value',
          `Mode ${boundedAuditText(modeId, 256)} has no value`,
          variable
        )
      }
    }

    let inspectedValues = 0
    for (const modeId in variable.valuesByMode) {
      if (!Object.hasOwn(variable.valuesByMode, modeId)) continue
      if (inspectedValues >= MAX_VARIABLE_MODE_VALUES) {
        markDesignSystemAuditBudgetExhausted(state)
        break
      }
      inspectedValues += 1
      if (!collection.modeIds.has(modeId)) {
        variableIssue(
          state,
          'unexpected-mode-value',
          `Mode ${boundedAuditText(modeId, 256)} is not declared`,
          variable
        )
      }
      const targetId = aliasId(variable.valuesByMode[modeId])
      if (!targetId) continue
      const target = editor.graph.variables.get(targetId)
      if (!target) {
        variableIssue(
          state,
          'missing-token-alias',
          `Alias target ${boundedAuditText(targetId, 256)} does not exist`,
          variable
        )
      } else if (target.type !== variable.type) {
        variableIssue(
          state,
          'token-alias-type-mismatch',
          `Alias target ${boundedAuditText(targetId, 256)} has type ${target.type}, expected ${variable.type}`,
          variable
        )
      }
    }
  }
}
