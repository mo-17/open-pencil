export type PluginAIUnknownRecord = Record<string, unknown>

export const BUILTIN_PLUGIN_AI_LIMITS = Object.freeze({
  maxMatches: 8,
  maxQueryLength: 256
})

export function parsePluginAIPlainInput(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>
): PluginAIUnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`)
  }
  const result: PluginAIUnknownRecord = Object.create(null) as PluginAIUnknownRecord
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      throw new TypeError(`${label} contains an unsupported field`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label}.${key} must be an enumerable data field`)
    }
    result[key] = descriptor.value
  }
  return result
}

export function boundedPluginAIString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`)
  const normalized = value.normalize('NFKC').trim()
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new TypeError(`${label} must contain between 1 and ${maximum} characters`)
  }
  return normalized
}
