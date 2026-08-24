export const BUILTIN_PLUGIN_JSON_LIMITS = Object.freeze({
  maxDepth: 16,
  maxNodes: 4_096,
  maxBytes: 64 * 1024
})

export interface BuiltinPluginJSONCloneOptions {
  readonly maxDepth?: number
  readonly maxNodes?: number
  readonly maxBytes?: number
}

export type BuiltinPluginJSONValue =
  | string
  | number
  | boolean
  | null
  | BuiltinPluginJSONObject
  | BuiltinPluginJSONArray

export interface BuiltinPluginJSONObject {
  readonly [key: string]: BuiltinPluginJSONValue
}

export type BuiltinPluginJSONArray = readonly BuiltinPluginJSONValue[]

interface ResolvedBuiltinPluginJSONLimits {
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxBytes: number
}

interface BuiltinPluginJSONCloneState {
  readonly limits: ResolvedBuiltinPluginJSONLimits
  readonly ancestors: WeakSet<object>
  nodes: number
}

const JSON_ENCODER = new TextEncoder()
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const ARRAY_INDEX_PATTERN = /^(?:0|[1-9][0-9]*)$/

function boundedLimit(
  value: number | undefined,
  fallback: number,
  minimum: number,
  label: string
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > fallback) {
    throw new TypeError(
      `Built-in plugin JSON ${label} limit must be between ${minimum} and ${fallback}`
    )
  }
  return resolved
}

function resolveLimits(options: BuiltinPluginJSONCloneOptions): ResolvedBuiltinPluginJSONLimits {
  return {
    maxDepth: boundedLimit(options.maxDepth, BUILTIN_PLUGIN_JSON_LIMITS.maxDepth, 0, 'depth'),
    maxNodes: boundedLimit(options.maxNodes, BUILTIN_PLUGIN_JSON_LIMITS.maxNodes, 1, 'node'),
    maxBytes: boundedLimit(options.maxBytes, BUILTIN_PLUGIN_JSON_LIMITS.maxBytes, 1, 'UTF-8 byte')
  }
}

function enumerableDataValue(descriptor: PropertyDescriptor | undefined): unknown {
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(
      'Built-in plugin JSON must only contain enumerable data properties, not getters or setters'
    )
  }
  return descriptor.value
}

function cloneArray(
  value: unknown[],
  depth: number,
  state: BuiltinPluginJSONCloneState
): BuiltinPluginJSONArray {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError('Built-in plugin JSON arrays must be plain arrays')
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !lengthDescriptor ||
    lengthDescriptor.enumerable ||
    !Object.hasOwn(lengthDescriptor, 'value') ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new TypeError('Built-in plugin JSON contains an invalid array')
  }
  const length = lengthDescriptor.value as number
  if (length > state.limits.maxNodes - state.nodes) {
    throw new TypeError('Built-in plugin JSON exceeds the node limit')
  }

  const keys = Reflect.ownKeys(value)
  for (const key of keys) {
    if (typeof key !== 'string') {
      throw new TypeError('Built-in plugin JSON must not contain symbol properties')
    }
    if (key !== 'length' && (!ARRAY_INDEX_PATTERN.test(key) || Number(key) >= length)) {
      throw new TypeError('Built-in plugin JSON arrays must not contain custom properties')
    }
  }

  const cloned: BuiltinPluginJSONValue[] = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor) throw new TypeError('Built-in plugin JSON arrays must not be sparse')
    const nested = enumerableDataValue(descriptor)
    Object.defineProperty(cloned, String(index), {
      value: cloneNode(nested, depth + 1, state),
      enumerable: true,
      configurable: true,
      writable: true
    })
  }
  return Object.freeze(cloned)
}

function cloneObject(
  value: object,
  depth: number,
  state: BuiltinPluginJSONCloneState
): BuiltinPluginJSONObject {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Built-in plugin JSON objects must be plain objects')
  }

  const keys = Reflect.ownKeys(value)
  if (keys.length > state.limits.maxNodes - state.nodes) {
    throw new TypeError('Built-in plugin JSON exceeds the node limit')
  }
  if (keys.some((key) => typeof key !== 'string')) {
    throw new TypeError('Built-in plugin JSON must not contain symbol properties')
  }

  const cloned = Object.create(null) as { [key: string]: BuiltinPluginJSONValue }
  for (const key of keys as string[]) {
    if (UNSAFE_JSON_KEYS.has(key)) {
      throw new TypeError(`Built-in plugin JSON contains unsafe key: ${key}`)
    }
    const nested = enumerableDataValue(Object.getOwnPropertyDescriptor(value, key))
    Object.defineProperty(cloned, key, {
      value: cloneNode(nested, depth + 1, state),
      enumerable: true,
      configurable: false,
      writable: false
    })
  }
  return Object.freeze(cloned)
}

function cloneNode(
  value: unknown,
  depth: number,
  state: BuiltinPluginJSONCloneState
): BuiltinPluginJSONValue {
  if (depth > state.limits.maxDepth) {
    throw new TypeError('Built-in plugin JSON exceeds the depth limit')
  }
  state.nodes += 1
  if (state.nodes > state.limits.maxNodes) {
    throw new TypeError('Built-in plugin JSON exceeds the node limit')
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Built-in plugin JSON numbers must be finite')
    }
    return value
  }
  if (typeof value !== 'object') {
    throw new TypeError('Built-in plugin JSON must only contain JSON values')
  }
  if (state.ancestors.has(value)) {
    throw new TypeError('Built-in plugin JSON must not contain cycles')
  }

  state.ancestors.add(value)
  try {
    return Array.isArray(value) ? cloneArray(value, depth, state) : cloneObject(value, depth, state)
  } finally {
    state.ancestors.delete(value)
  }
}

/**
 * Defensively clones untrusted JSON without invoking property accessors.
 *
 * The returned arrays and null-prototype objects are deeply frozen. Callers may lower, but not
 * raise, the shared complexity and serialized UTF-8 byte limits.
 */
export function cloneBuiltinPluginJSON(
  value: unknown,
  options: BuiltinPluginJSONCloneOptions = {}
): BuiltinPluginJSONValue {
  const limits = resolveLimits(options)
  const cloned = cloneNode(value, 0, {
    limits,
    ancestors: new WeakSet(),
    nodes: 0
  })
  const serialized = JSON.stringify(cloned)
  if (JSON_ENCODER.encode(serialized).byteLength > limits.maxBytes) {
    throw new TypeError('Built-in plugin JSON exceeds the UTF-8 byte limit')
  }
  return cloned
}
