import type { JSONObject } from './primitives'

export interface ModuleInstanceV1 {
  version: 1
  pluginId: string
  moduleType: string
  configVersion: number
  config: JSONObject
}

export const MODULE_INSTANCE_LIMITS = Object.freeze({
  maxBytes: 64 * 1024,
  maxDepth: 12,
  maxEntries: 2_048,
  maxArrayItems: 1_000,
  maxKeyLength: 256,
  maxStringLength: 16 * 1024,
  maxIdentityLength: 128
})

export type ModuleInstanceValidationResult =
  | { ok: true; value: ModuleInstanceV1 }
  | { ok: false; reason: string }

const MODULE_INSTANCE_KEYS = new Set([
  'version',
  'pluginId',
  'moduleType',
  'configVersion',
  'config'
])
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const MODULE_IDENTITY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/

interface JSONValidationState {
  entries: number
  arrayItems: number
  seen: WeakSet<object>
}

export function isPlainJSONObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function requireExactJSONObject(
  value: unknown,
  keys: readonly string[],
  path: string
): JSONObject {
  if (!isPlainJSONObject(value)) throw new TypeError(`${path} must be an object`)
  const remaining = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!remaining.delete(key)) {
      throw new TypeError(`${path} must contain exactly: ${keys.join(', ')}`)
    }
  }
  if (remaining.size > 0) {
    throw new TypeError(`${path} must contain exactly: ${keys.join(', ')}`)
  }
  return value
}

function ownDataEntries(value: object, path: string): [string, unknown][] | string {
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string')) return `${path} must not contain symbol keys`
  const entries: [string, unknown][] = []
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return `${path}.${key} must be an enumerable data property`
    }
    entries.push([key, descriptor.value])
  }
  return entries
}

function validateJSONArray(
  value: unknown[],
  path: string,
  depth: number,
  state: JSONValidationState
): string | null {
  state.arrayItems += value.length
  if (state.arrayItems > MODULE_INSTANCE_LIMITS.maxArrayItems) {
    return `${path} exceeds the maximum total array items of ${MODULE_INSTANCE_LIMITS.maxArrayItems}`
  }
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.some(
      (key) => typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key))
    ) ||
    ownKeys.length !== value.length + 1
  ) {
    return `${path} must be a dense JSON array without custom properties`
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return `${path} must be a dense JSON array`
    }
    const reason = validateJSON(descriptor.value, `${path}[${index}]`, depth + 1, state)
    if (reason) return reason
  }
  return null
}

function validateJSONObject(
  value: object,
  path: string,
  depth: number,
  state: JSONValidationState
): string | null {
  if (!isPlainJSONObject(value)) return `${path} must be a plain JSON object`
  const entries = ownDataEntries(value, path)
  if (typeof entries === 'string') return entries
  state.entries += entries.length
  if (state.entries > MODULE_INSTANCE_LIMITS.maxEntries) {
    return `${path} exceeds the maximum total object entries of ${MODULE_INSTANCE_LIMITS.maxEntries}`
  }
  for (const [key, entry] of entries) {
    if (UNSAFE_KEYS.has(key)) return `${path} contains unsafe key "${key}"`
    if (key.length > MODULE_INSTANCE_LIMITS.maxKeyLength) {
      return `${path} contains a key longer than ${MODULE_INSTANCE_LIMITS.maxKeyLength}`
    }
    const reason = validateJSON(entry, `${path}.${key}`, depth + 1, state)
    if (reason) return reason
  }
  return null
}

function validateJSON(
  value: unknown,
  path: string,
  depth: number,
  state: JSONValidationState
): string | null {
  if (depth > MODULE_INSTANCE_LIMITS.maxDepth) {
    return `${path} exceeds the maximum JSON depth of ${MODULE_INSTANCE_LIMITS.maxDepth}`
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return typeof value === 'number' && !Number.isFinite(value)
      ? `${path} must contain only finite numbers`
      : null
  }
  if (typeof value === 'string') {
    return value.length > MODULE_INSTANCE_LIMITS.maxStringLength
      ? `${path} exceeds the maximum string length of ${MODULE_INSTANCE_LIMITS.maxStringLength}`
      : null
  }
  if (typeof value !== 'object') return `${path} contains a non-JSON value`
  if (state.seen.has(value)) return `${path} contains a circular reference`
  state.seen.add(value)
  return Array.isArray(value)
    ? validateJSONArray(value, path, depth, state)
    : validateJSONObject(value, path, depth, state)
}

export function validateModuleIdentity(value: unknown, path = 'module identity'): string | null {
  if (typeof value !== 'string' || value.length === 0) return `${path} must be a non-empty string`
  if (value.length > MODULE_INSTANCE_LIMITS.maxIdentityLength) {
    return `${path} exceeds the maximum length of ${MODULE_INSTANCE_LIMITS.maxIdentityLength}`
  }
  return MODULE_IDENTITY.test(value)
    ? null
    : `${path} must use lowercase letters, numbers, dots, underscores, or hyphens`
}

export function moduleDefinitionKey(pluginId: string, moduleType: string): string {
  return `${pluginId}/${moduleType}`
}

export function moduleInstanceKey(
  instance: Pick<ModuleInstanceV1, 'pluginId' | 'moduleType'>
): string {
  return moduleDefinitionKey(instance.pluginId, instance.moduleType)
}

export function validateModuleInstance(value: unknown): ModuleInstanceValidationResult {
  if (!isPlainJSONObject(value)) {
    return { ok: false, reason: 'module must be a plain JSON object' }
  }
  const jsonReason = validateJSON(value, 'module', 0, {
    entries: 0,
    arrayItems: 0,
    seen: new WeakSet()
  })
  if (jsonReason) return { ok: false, reason: jsonReason }
  const keys = Object.keys(value)
  if (
    keys.length !== MODULE_INSTANCE_KEYS.size ||
    keys.some((key) => !MODULE_INSTANCE_KEYS.has(key))
  ) {
    return {
      ok: false,
      reason: 'module must contain exactly version, pluginId, moduleType, configVersion, and config'
    }
  }
  if (value.version !== 1) return { ok: false, reason: 'module.version must be 1' }
  const pluginReason = validateModuleIdentity(value.pluginId, 'module.pluginId')
  if (pluginReason) return { ok: false, reason: pluginReason }
  const typeReason = validateModuleIdentity(value.moduleType, 'module.moduleType')
  if (typeReason) return { ok: false, reason: typeReason }
  if (!Number.isSafeInteger(value.configVersion) || (value.configVersion as number) < 1) {
    return { ok: false, reason: 'module.configVersion must be a positive safe integer' }
  }
  if (!isPlainJSONObject(value.config)) {
    return { ok: false, reason: 'module.config must be a plain JSON object' }
  }
  const serialized = JSON.stringify(value)
  if (new TextEncoder().encode(serialized).byteLength > MODULE_INSTANCE_LIMITS.maxBytes) {
    return {
      ok: false,
      reason: `module exceeds the maximum serialized size of ${MODULE_INSTANCE_LIMITS.maxBytes} bytes`
    }
  }
  return {
    ok: true,
    value: {
      version: 1,
      pluginId: value.pluginId as string,
      moduleType: value.moduleType as string,
      configVersion: value.configVersion as number,
      config: structuredClone(value.config)
    }
  }
}

export function readModuleInstance(value: unknown): ModuleInstanceV1 | null {
  const result = validateModuleInstance(value)
  return result.ok ? result.value : null
}

export function cloneModuleInstance(instance: ModuleInstanceV1): ModuleInstanceV1 {
  const result = validateModuleInstance(instance)
  if (!result.ok) throw new TypeError(result.reason)
  return result.value
}
