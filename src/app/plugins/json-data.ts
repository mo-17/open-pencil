export interface PluginJSONDataRecord {
  readonly [key: string]: unknown
}

interface MutablePluginJSONDataRecord {
  [key: string]: unknown
}

export interface JSONTraversalState {
  nodes: number
  readonly ancestors: WeakSet<object>
}

/**
 * Copy a plain object through own enumerable data descriptors only.
 *
 * Accessors, symbols, arrays, and exotic prototypes are rejected without reading attacker-owned
 * properties. Callers may apply a key-count limit before descriptor inspection.
 */
export function strictPlainDataRecord(
  value: unknown,
  path: string,
  maximumKeys?: number,
  maximumKeysMessage?: string
): PluginJSONDataRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object`)
  }
  const keys = Reflect.ownKeys(value)
  if (maximumKeys !== undefined && keys.length > maximumKeys) {
    throw new TypeError(maximumKeysMessage ?? `${path} exceeds the field limit`)
  }
  const normalized = Object.create(null) as MutablePluginJSONDataRecord
  for (const key of keys) {
    if (typeof key !== 'string') throw new TypeError(`${path} must not contain symbol fields`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${path}.${key} must be an enumerable data field`)
    }
    normalized[key] = descriptor.value
  }
  return normalized
}
