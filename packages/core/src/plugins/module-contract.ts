import {
  isPlainJsonObject,
  validateModuleInstance,
  type ModuleInstanceV1,
  type SceneNode
} from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import { hasExactPluginKeys, mergePluginConfigWithDefaults } from './parse-helpers'
import type {
  ModuleDefinition,
  ModulePropertyField,
  ModuleResolution,
  PluginDefinition
} from './types'

export type ModuleConfigParseResult<TConfig extends JsonObject> =
  | { ok: true; config: TConfig }
  | { ok: false; reason: string }

export interface ModuleContract<TConfig extends JsonObject> {
  pluginId: string
  moduleType: string
  configVersion: number
  displayName: string
  defaultConfig: Readonly<TConfig>
  parseConfig: (value: unknown) => ModuleConfigParseResult<TConfig>
}

export interface ModuleDefinitionMetadata<TConfig extends JsonObject> {
  name: string
  description: string
  i18nNameKey: string
  i18nDescriptionKey: string
  defaultSize: Readonly<Pick<SceneNode, 'width' | 'height'>>
  fields: readonly ModulePropertyField[]
  createInstance: (config?: unknown) => ModuleInstanceV1
  createFrameOverrides: (config?: unknown) => Partial<SceneNode>
  resolve: (value: unknown) => ModuleResolution<TConfig>
}

interface MutableModuleDataRecord {
  [key: string]: unknown
}

export function parseExactModuleConfig<TConfig extends JsonObject>(
  value: unknown,
  keys: ReadonlySet<string>,
  exactKeysReason: string,
  parse: (source: Readonly<Record<string, unknown>>) => TConfig
): ModuleConfigParseResult<TConfig> {
  if (!isPlainJsonObject(value) || !hasExactPluginKeys(value, keys)) {
    return { ok: false, reason: exactKeysReason }
  }
  try {
    return { ok: true, config: parse(value) }
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) }
  }
}

export function parseBoundedModuleObjectArray<TValue>(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
  lengthReason: string,
  itemReason: (index: number) => string,
  parse: (entry: Readonly<Record<string, unknown>>, index: number) => TValue
): TValue[] {
  if (!Array.isArray(value) || value.length < minimumLength || value.length > maximumLength) {
    throw new TypeError(lengthReason)
  }
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      !isPlainJsonObject(descriptor.value)
    ) {
      throw new TypeError(itemReason(index))
    }
    const entry = Object.create(null) as MutableModuleDataRecord
    for (const key of Reflect.ownKeys(descriptor.value)) {
      if (typeof key !== 'string') throw new TypeError(itemReason(index))
      const field = Object.getOwnPropertyDescriptor(descriptor.value, key)
      if (!field?.enumerable || !('value' in field)) throw new TypeError(itemReason(index))
      Object.defineProperty(entry, key, {
        configurable: true,
        enumerable: true,
        value: field.value,
        writable: true
      })
    }
    return parse(entry, index)
  })
}

export function createContractModuleInstance<TConfig extends JsonObject>(
  contract: ModuleContract<TConfig>,
  config?: unknown
): ModuleInstanceV1 {
  const parsed = contract.parseConfig(mergePluginConfigWithDefaults(contract.defaultConfig, config))
  if (!parsed.ok) throw new TypeError(parsed.reason)
  return {
    version: 1,
    pluginId: contract.pluginId,
    moduleType: contract.moduleType,
    configVersion: contract.configVersion,
    config: parsed.config
  }
}

export function resolveContractModule<TConfig extends JsonObject>(
  value: unknown,
  contract: ModuleContract<TConfig>
): ModuleResolution<TConfig> {
  if (value === null || value === undefined) return null
  const instance = validateModuleInstance(value)
  if (!instance.ok) return { ok: false, reason: instance.reason }
  if (
    instance.value.pluginId !== contract.pluginId ||
    instance.value.moduleType !== contract.moduleType
  ) {
    return null
  }
  if (instance.value.configVersion !== contract.configVersion) {
    return {
      ok: false,
      reason: `unsupported ${contract.displayName} config version ${instance.value.configVersion}`
    }
  }
  const parsed = contract.parseConfig(instance.value.config)
  if (!parsed.ok) return parsed
  return {
    ok: true,
    instance: { ...instance.value, config: parsed.config },
    config: parsed.config
  }
}

export function createContractModuleDefinition<TConfig extends JsonObject>(
  contract: ModuleContract<TConfig>,
  metadata: ModuleDefinitionMetadata<TConfig>
): ModuleDefinition<TConfig> {
  return Object.freeze({
    pluginId: contract.pluginId,
    moduleType: contract.moduleType,
    name: metadata.name,
    description: metadata.description,
    i18nNameKey: metadata.i18nNameKey,
    i18nDescriptionKey: metadata.i18nDescriptionKey,
    configVersion: contract.configVersion,
    defaultSize: metadata.defaultSize,
    defaultConfig: structuredClone(contract.defaultConfig),
    fields: metadata.fields,
    createInstance: metadata.createInstance,
    createFrameOverrides: metadata.createFrameOverrides,
    resolve: metadata.resolve
  })
}

export function createSingleModulePlugin(
  id: string,
  name: string,
  module: ModuleDefinition
): PluginDefinition {
  return Object.freeze({ id, name, version: '1.0.0', modules: Object.freeze([module]) })
}
