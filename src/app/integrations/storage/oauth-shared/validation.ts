export type OAuthRecord = Record<string, unknown>

const ASCII_GRAPHIC_PATTERN = /^[\x21-\x7e]+$/
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u
const WHITESPACE_PATTERN = /\s/u
const MAX_OAUTH_DATA_DEPTH = 16
const MAX_OAUTH_DATA_NODES = 512
const MAX_OAUTH_DATA_KEYS = 256

export function oauthUTF8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function oauthSerializedBytes(value: unknown): number | null {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    return null
  }
  return typeof serialized === 'string' ? oauthUTF8Bytes(serialized) : null
}

function isOAuthArrayIndex(key: string, length: number): boolean {
  if (!/^(?:0|[1-9]\d*)$/u.test(key)) return false
  const index = Number(key)
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key
}

function hasOAuthDataPrototype(value: object, array: boolean): boolean {
  const prototype = Object.getPrototypeOf(value)
  return array
    ? prototype === Array.prototype
    : prototype === Object.prototype || prototype === null
}

function oauthArrayLength(value: object): number | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (descriptor?.enumerable !== false || !Object.hasOwn(descriptor, 'value')) return null
  return Number.isSafeInteger(descriptor.value) && descriptor.value >= 0 ? descriptor.value : null
}

function oauthOwnDataValue(
  value: object,
  key: string,
  arrayLength: number | null
): readonly [unknown] | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return null
  if (arrayLength !== null && !isOAuthArrayIndex(key, arrayLength)) return null
  return [descriptor.value]
}

function oauthOwnDataValues(value: object): readonly unknown[] | null {
  const array = Array.isArray(value)
  if (!hasOAuthDataPrototype(value, array)) return null
  const arrayLength = array ? oauthArrayLength(value) : null
  if (array && arrayLength === null) return null
  const keys = Reflect.ownKeys(value)
  if (keys.length > MAX_OAUTH_DATA_KEYS || keys.some((key) => typeof key !== 'string')) return null
  const values: unknown[] = []
  for (const key of keys as string[]) {
    if (array && key === 'length') continue
    const entry = oauthOwnDataValue(value, key, arrayLength)
    if (!entry) return null
    values.push(entry[0])
  }
  return values
}

function isOAuthDataTree(
  value: unknown,
  depth: number,
  budget: { nodes: number },
  ancestors: WeakSet<object>
): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || depth > MAX_OAUTH_DATA_DEPTH) return false
  budget.nodes += 1
  if (budget.nodes > MAX_OAUTH_DATA_NODES || ancestors.has(value)) return false
  ancestors.add(value)
  try {
    const children = oauthOwnDataValues(value)
    return children?.every((child) => isOAuthDataTree(child, depth + 1, budget, ancestors)) ?? false
  } catch {
    return false
  } finally {
    ancestors.delete(value)
  }
}

function oauthDataKeys(value: object): readonly string[] | null {
  try {
    if (!isOAuthDataTree(value, 0, { nodes: 0 }, new WeakSet())) return null
    // The structured-clone algorithm rejects Proxy objects. Descriptor-only traversal above avoids
    // invoking getters first, while this final probe closes Proxy get/ownKeys validate-then-swap.
    structuredClone(value)
    const ownKeys = Reflect.ownKeys(value)
    return ownKeys as string[]
  } catch {
    return null
  }
}

export function isOAuthRecord(value: unknown): value is OAuthRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    oauthDataKeys(value) !== null
  )
}

export function hasExactOAuthKeys(
  value: OAuthRecord,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const allowed = new Set([...required, ...optional])
  const keys = oauthDataKeys(value)
  return (
    keys !== null &&
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => allowed.has(key))
  )
}

export function isBoundedOAuthText(
  value: unknown,
  options: Readonly<{
    maxLength?: number
    maxBytes?: number
    requireTrimmed?: boolean
  }>
): value is string {
  if (typeof value !== 'string' || value.length === 0 || CONTROL_CHARACTER_PATTERN.test(value)) {
    return false
  }
  if (options.requireTrimmed && value.trim() !== value) return false
  if (options.maxLength !== undefined && value.length > options.maxLength) return false
  return options.maxBytes === undefined || oauthUTF8Bytes(value) <= options.maxBytes
}

export function isBoundedOAuthToken(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === 'string' &&
    oauthUTF8Bytes(value) > 0 &&
    oauthUTF8Bytes(value) <= maxBytes &&
    value.trim() === value &&
    !WHITESPACE_PATTERN.test(value) &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  )
}

export function isBoundedASCIISecret(
  value: unknown,
  minBytes: number,
  maxBytes: number
): value is string {
  return (
    typeof value === 'string' &&
    oauthUTF8Bytes(value) >= minBytes &&
    oauthUTF8Bytes(value) <= maxBytes &&
    ASCII_GRAPHIC_PATTERN.test(value)
  )
}

export function hasExactOAuthValueSet<T extends string>(
  value: unknown,
  expected: readonly T[]
): value is readonly T[] {
  if (!Array.isArray(value) || value.length !== expected.length) return false
  const values = new Set(value)
  return values.size === expected.length && expected.every((entry) => values.has(entry))
}

export function parseBoundedOAuthJSON(
  value: unknown,
  maxBytes: number,
  invalid: () => Error,
  tooLarge: () => Error = invalid
): unknown {
  if (typeof value !== 'string' || value.length === 0) throw invalid()
  if (oauthUTF8Bytes(value) > maxBytes) throw tooLarge()
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw invalid()
  }
}

export function stringifyBoundedOAuthJSON(
  value: unknown,
  maxBytes: number,
  invalid: () => Error
): string {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw invalid()
  }
  if (typeof serialized !== 'string' || oauthUTF8Bytes(serialized) > maxBytes) throw invalid()
  return serialized
}
